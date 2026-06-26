import { watch, existsSync, readFileSync, type FSWatcher } from 'fs'
import { join, basename, sep } from 'path'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { listWorkspaces } from '../database/repositories/workspaces'
import { getWorkspaceVaultDir } from './paths'
import { reindexFile, deleteIndexRowByPath, type ReindexResult } from './documents-service'
import { consumeSelfWrite } from './self-write'
import { kindForExt } from './artifact-kinds'

/**
 * The vault watcher. Observes every workspace folder for external `.md`/artifact
 * changes (other editors, Obsidian, sync, the agent writing outside the app) and
 * broadcasts the SAME change events the renderer already understands
 * (documents:content-changed / documents:changed), so the open note live-reloads
 * in place. The app's own atomic writes are recognized (and ignored) via the
 * self-write registry plus a content-diff in reindexFile — it never echo-loops.
 *
 * Workspaces are now arbitrary folders anywhere on disk (`ws.path`), so there is
 * no single root to watch. We keep ONE recursive `FSWatcher` per existing
 * workspace folder (keyed by its absolute, NFC-normalized root). A folder that
 * doesn't exist (an "unavailable" workspace) is simply not watched; the watcher
 * is re-aimed via restartVaultWatcher when a workspace is created/relocated.
 *
 * Mirrors theme-watcher's module-singleton + debounce + isDestroyed-guard shape.
 * Every change flows through the per-path, READ-ONLY reindexFile (it never
 * writes to disk), so the watcher is a pure observer.
 */

const DEBOUNCE_MS = 200
const DELETE_SETTLE_MS = 120 // re-verify a deletion before pruning (handles delete+recreate flaps)
const IGNORED_DIRS = new Set(['.git', '.obsidian', 'node_modules', 'attachments', '.trash'])

const watchers = new Map<string, FSWatcher>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const settleTimers = new Set<ReturnType<typeof setTimeout>>()
let stopped = true
let storedDb: Database.Database | null = null
let storedWindow: BrowserWindow | null = null

/** The set of absolute, NFC-normalized workspace folders that currently exist. */
function currentRoots(db: Database.Database): string[] {
  const roots = new Set<string>()
  for (const ws of listWorkspaces(db)) {
    const dir = getWorkspaceVaultDir(db, ws.id).normalize('NFC')
    if (existsSync(dir)) roots.add(dir)
  }
  return [...roots]
}

function isIgnoredPath(relPath: string): boolean {
  for (const segment of relPath.split(sep)) {
    if (segment.startsWith('.')) return true // dotfiles + our `.<name>.tmp-*` temp writes
    if (IGNORED_DIRS.has(segment)) return true
  }
  // Accept any extension registered in artifact-kinds (`.md` notes + artifacts);
  // an unmapped extension is not indexed, so its events are dropped.
  return kindForExt(basename(relPath)) === null
}

function alive(): boolean {
  return !stopped && !!storedDb && !!storedWindow && !storedWindow.isDestroyed()
}

function send(channel: 'documents:content-changed' | 'documents:changed', payload?: unknown): void {
  if (!storedWindow || storedWindow.isDestroyed()) return
  storedWindow.webContents.send(channel, payload)
}

function broadcast(result: ReindexResult): void {
  switch (result.kind) {
    case 'updated':
      send('documents:content-changed', { id: result.docId })
      if (result.structuralChanged) send('documents:changed')
      break
    case 'created':
      send('documents:content-changed', { id: result.docId })
      send('documents:changed')
      break
    case 'deleted':
      send('documents:changed')
      break
    case 'unchanged':
    case 'ignored':
      break
  }
}

function handlePath(abs: string): void {
  if (!alive()) return
  const db = storedDb!

  // Self-write short-circuit (optimization): if the bytes on disk match a write
  // we just made, drop the event. Content-hash keyed, so it survives any FS
  // latency. reindexFile's content-diff is the backstop if this ever misses.
  // Notes only — the app NEVER writes artifacts (artifact reconcile is read-only,
  // no echo loop), so there is nothing to suppress, and this avoids reading a
  // multi-megabyte artifact as utf-8 on every event.
  if (existsSync(abs) && kindForExt(abs) === 'note') {
    try {
      const raw = readFileSync(abs, 'utf-8')
      if (consumeSelfWrite(abs, raw)) return
    } catch {
      // fall through to a normal reindex
    }
  }

  const result = reindexFile(db, abs)

  if (result.kind === 'deleted') {
    // Re-verify after a short settle window: a delete+recreate flap (or an
    // external rename processed old-path-first) should not surface as a spurious
    // deletion of the still-valid note. reindexFile reported the missing path
    // but did NOT prune the row — we prune here only once the absence holds.
    const t = setTimeout(() => {
      settleTimers.delete(t)
      if (!alive()) return
      if (existsSync(abs)) {
        broadcast(reindexFile(storedDb!, abs))
      } else {
        const removed = deleteIndexRowByPath(storedDb!, abs)
        if (removed) broadcast(result)
      }
    }, DELETE_SETTLE_MS)
    settleTimers.add(t)
    return
  }
  broadcast(result)
}

function onEvent(root: string, _eventType: string, filename: string | Buffer | null): void {
  if (stopped || filename == null) return
  const rel = filename.toString()
  if (isIgnoredPath(rel)) return
  const abs = join(root, rel).normalize('NFC')

  // Per-path debounce: coalesces the temp+rename event pair (and rapid repeated
  // saves) into a single reconcile. Each fires as its own macrotask, so even a
  // large bulk change (git checkout) yields to the event loop between files.
  const prev = timers.get(abs)
  if (prev) clearTimeout(prev)
  timers.set(
    abs,
    setTimeout(() => {
      timers.delete(abs)
      handlePath(abs)
    }, DEBOUNCE_MS)
  )
}

/**
 * Reconcile the set of live `FSWatcher`s with the workspaces on disk: open a
 * recursive watcher for every existing workspace folder not already watched, and
 * close watchers whose folder is gone (a deleted/relocated workspace). Idempotent
 * — safe to call on create/relocate/delete or whenever the workspace set changes.
 */
function syncWatchers(db: Database.Database): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    // Recursive fs.watch is only reliable on macOS/Windows. The primary build
    // target is macOS; elsewhere the watcher is simply disabled.
    console.info('[vault-watcher] recursive fs.watch unsupported on this platform; disabled')
    return
  }
  const desired = new Set(currentRoots(db))

  // Drop watchers whose folder is no longer a (present) workspace root.
  for (const [root, w] of watchers) {
    if (!desired.has(root)) {
      w.close()
      watchers.delete(root)
    }
  }

  // Add a watcher for each newly-present root. A missing folder (an "unavailable"
  // workspace) is intentionally skipped — we do NOT mkdir it back into existence.
  for (const root of desired) {
    if (watchers.has(root)) continue
    try {
      watchers.set(
        root,
        watch(root, { recursive: true }, (eventType, filename) => onEvent(root, eventType, filename))
      )
    } catch (err) {
      console.error('[vault-watcher] failed to watch', root, err)
    }
  }
}

export function startVaultWatcher(db: Database.Database, mainWindow: BrowserWindow): void {
  stopVaultWatcher()
  storedDb = db
  storedWindow = mainWindow
  stopped = false
  syncWatchers(db)
}

export function restartVaultWatcher(): void {
  if (!storedDb || !storedWindow || storedWindow.isDestroyed()) return
  stopped = false
  syncWatchers(storedDb)
}

export function stopVaultWatcher(): void {
  stopped = true
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  for (const t of settleTimers) clearTimeout(t)
  settleTimers.clear()
  for (const w of watchers.values()) w.close()
  watchers.clear()
}
