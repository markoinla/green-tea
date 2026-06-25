import { watch, existsSync, mkdirSync, readFileSync, type FSWatcher } from 'fs'
import { join, basename, sep } from 'path'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { getVaultsRoot } from './paths'
import { reindexFile, deleteIndexRowByPath, type ReindexResult } from './documents-service'
import { consumeSelfWrite } from './self-write'
import { kindForExt } from './artifact-kinds'

/**
 * The vault watcher (Phase 5). Observes the vaults/ tree for external .md
 * changes (other editors, Obsidian, sync, the agent writing outside the app)
 * and broadcasts the SAME change events the renderer already understands
 * (documents:content-changed / documents:changed), so the open note live-reloads
 * in place. The app's own atomic writes are recognized (and ignored) via the
 * self-write registry plus a content-diff in reindexFile — it never echo-loops.
 *
 * Mirrors theme-watcher's module-singleton + debounce + isDestroyed-guard shape.
 * Every change flows through the per-path, READ-ONLY reindexFile (it never
 * writes to disk), so the watcher is a pure observer.
 */

const DEBOUNCE_MS = 200
const DELETE_SETTLE_MS = 120 // re-verify a deletion before pruning (handles delete+recreate flaps)
const IGNORED_DIRS = new Set(['.git', '.obsidian', 'node_modules', 'attachments', '.trash'])

let watcher: FSWatcher | null = null
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const settleTimers = new Set<ReturnType<typeof setTimeout>>()
let stopped = true
let watchedRoot: string | null = null
let storedDb: Database.Database | null = null
let storedWindow: BrowserWindow | null = null

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

function onEvent(_eventType: string, filename: string | Buffer | null): void {
  if (stopped || filename == null || !watchedRoot) return
  const rel = filename.toString()
  if (isIgnoredPath(rel)) return
  const abs = join(watchedRoot, rel).normalize('NFC')

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

function startWatching(db: Database.Database, mainWindow: BrowserWindow): void {
  stopVaultWatcher()
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    // Recursive fs.watch is only reliable on macOS/Windows. The primary build
    // target is macOS; elsewhere the watcher is simply disabled.
    console.info('[vault-watcher] recursive fs.watch unsupported on this platform; disabled')
    return
  }
  const root = getVaultsRoot(db).normalize('NFC')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  watchedRoot = root
  storedDb = db
  storedWindow = mainWindow
  stopped = false
  try {
    watcher = watch(root, { recursive: true }, onEvent)
  } catch (err) {
    console.error('[vault-watcher] failed to start', err)
    stopped = true
    watchedRoot = null
  }
}

export function startVaultWatcher(db: Database.Database, mainWindow: BrowserWindow): void {
  storedDb = db
  storedWindow = mainWindow
  startWatching(db, mainWindow)
}

export function restartVaultWatcher(): void {
  if (!storedDb || !storedWindow || storedWindow.isDestroyed()) return
  const newRoot = getVaultsRoot(storedDb).normalize('NFC')
  if (newRoot === watchedRoot && watcher) return
  startWatching(storedDb, storedWindow)
}

export function stopVaultWatcher(): void {
  stopped = true
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  for (const t of settleTimers) clearTimeout(t)
  settleTimers.clear()
  if (watcher) {
    watcher.close()
    watcher = null
  }
  watchedRoot = null
}
