import { watch, existsSync, readFileSync, type FSWatcher } from 'fs'
import { join, basename, sep } from 'path'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { listWorkspaces } from '../database/repositories/workspaces'
import { getWorkspaceVaultDir } from './paths'
import {
  reindexFile,
  deleteIndexRowByPath,
  pruneMissingFolders,
  reindexWorkspace,
  indexHasEntriesUnder,
  getVaultDirsByWorkspace,
  type ReindexResult
} from './documents-service'
import { consumeSelfWrite, hasSelfWrite } from './self-write'
import { kindForExt } from './artifact-kinds'
import { recordDirtyPath } from '../git/auto-commit'

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
// Reindex delay after an indexed directory vanishes: past the per-file debounce
// (200ms) + delete settle (120ms), so any child-file events that DO arrive win
// the race and the reindex observes the settled final state.
const DIR_GONE_REINDEX_MS = 500
const IGNORED_DIRS = new Set(['.git', '.obsidian', 'node_modules', 'attachments', '.trash'])

const watchers = new Map<string, FSWatcher>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
// Per-workspace-root debounce for folder-structure (directory removal) reconciles.
const folderTimers = new Map<string, ReturnType<typeof setTimeout>>()
// Per-workspace-root debounce for the post-directory-removal workspace reindex.
const reindexTimers = new Map<string, ReturnType<typeof setTimeout>>()
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

function hasIgnoredSegment(relPath: string): boolean {
  for (const segment of relPath.split(sep)) {
    if (segment.startsWith('.')) return true // dotfiles + our `.<name>.tmp-*` temp writes
    if (IGNORED_DIRS.has(segment)) return true
  }
  return false
}

// An indexed path is one whose extension is registered in artifact-kinds (`.md`
// notes + artifacts). Non-indexed paths are usually directories — their only
// reconcile-worthy event is removal (a deleted/renamed folder), handled below.
function isIndexedFile(relPath: string): boolean {
  return kindForExt(basename(relPath)) !== null
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

function owningWorkspace(forPath: string): { workspaceId: string; dir: string } | undefined {
  return getVaultDirsByWorkspace(storedDb!).find(
    (e) => forPath === e.dir || forPath.startsWith(e.dir + sep)
  )
}

/**
 * Reconcile folder rows for the workspace owning `forPath` after a deletion:
 * prune any whose directory is now gone. Debounced per workspace root and run on
 * a settle delay so a delete+recreate flap doesn't churn rows. pruneMissingFolders
 * only drops doc rows whose file is genuinely absent, so a rename/move that a
 * per-file reindex already re-pointed is never clobbered here.
 */
function scheduleFolderReconcile(forPath: string): void {
  if (!alive()) return
  const entry = owningWorkspace(forPath)
  if (!entry) return
  const prev = folderTimers.get(entry.dir)
  if (prev) clearTimeout(prev)
  folderTimers.set(
    entry.dir,
    setTimeout(() => {
      folderTimers.delete(entry.dir)
      if (!alive()) return
      if (pruneMissingFolders(storedDb!, entry.workspaceId)) send('documents:changed')
    }, DELETE_SETTLE_MS)
  )
}

/**
 * A directory the index knows about vanished. That is EITHER a genuine folder
 * delete OR a Finder rename/move — and macOS FSEvents does not reliably emit
 * per-child create events for the new location, so eagerly pruning by the old
 * path would drop the (still existing) notes until the next launch reindex.
 * Instead, rebuild the whole workspace index (debounced per root, delayed past
 * the per-file debounce+settle): a renamed folder's notes are re-homed in place
 * (upsert by stable frontmatter id — agent logs survive), a genuinely deleted
 * folder's rows are pruned. Paths the index knows nothing about (a stray
 * non-indexed file) fall back to the cheap folder-row prune, so this never
 * degenerates into a full reindex on every event.
 */
function scheduleDirGoneReconcile(forPath: string): void {
  if (!alive()) return
  const entry = owningWorkspace(forPath)
  if (!entry) return
  if (!indexHasEntriesUnder(storedDb!, entry.workspaceId, forPath)) {
    scheduleFolderReconcile(forPath)
    return
  }
  const prev = reindexTimers.get(entry.dir)
  if (prev) clearTimeout(prev)
  reindexTimers.set(
    entry.dir,
    setTimeout(() => {
      reindexTimers.delete(entry.dir)
      if (!alive()) return
      // A missing root is an "unavailable" workspace — never mkdir it back.
      if (!existsSync(entry.dir)) return
      try {
        reindexWorkspace(storedDb!, entry.workspaceId)
        send('documents:changed')
      } catch (err) {
        console.error('[vault-watcher] reindex after directory removal failed', err)
      }
    }, DIR_GONE_REINDEX_MS)
  )
}

function handlePath(root: string, abs: string): void {
  if (!alive()) return
  const db = storedDb!

  // Self-write short-circuit (optimization): if the bytes on disk match a write
  // we just made, drop the event. Content-hash keyed, so it survives any FS
  // latency. reindexFile's content-diff is the backstop if this ever misses.
  // Gated on a pending registry entry (hasSelfWrite) so we only read the file —
  // possibly a multi-megabyte artifact — when there's actually a self-write to
  // confirm. Covers notes (every save) AND artifacts (inline HTML text edits,
  // which write the .html directly); external edits have no entry and skip this.
  if (existsSync(abs) && hasSelfWrite(abs)) {
    try {
      const raw = readFileSync(abs, 'utf-8')
      if (consumeSelfWrite(abs, raw)) {
        // Our own in-app save. We skip the reindex (the app already updated the
        // index directly), but STILL feed the path to the debounced auto-committer
        // so in-app edits land in version history — not just external/agent ones.
        // Loop-safe: the eventual commit writes only under .git/ (watcher-ignored)
        // and re-hashes this file without rewriting it.
        recordDirtyPath(root, abs)
        return
      }
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
        if (removed) {
          broadcast(result)
          // Feed the confirmed deletion to the debounced auto-committer (git.remove
          // stages it). Only after the absence holds, so a delete+recreate flap
          // doesn't queue a spurious removal.
          recordDirtyPath(root, abs)
        }
        // The file may have vanished because its whole folder was deleted; prune
        // any now-missing folder rows (no-op if the folder still exists on disk).
        scheduleFolderReconcile(abs)
      }
    }, DELETE_SETTLE_MS)
    settleTimers.add(t)
    return
  }
  // A real content change — feed the dirty path to the debounced auto-commit safety
  // net (§4.5). Confirmed self-writes recorded + returned above; this covers external
  // /agent edits and any self-write whose bytes changed again before we read them.
  // 'unchanged'/'ignored' are skipped.
  if (result.kind === 'created' || result.kind === 'updated') recordDirtyPath(root, abs)
  broadcast(result)
}

function onEvent(root: string, _eventType: string, filename: string | Buffer | null): void {
  if (stopped || filename == null) return
  const rel = filename.toString()
  if (hasIgnoredSegment(rel)) return
  const abs = join(root, rel).normalize('NFC')

  if (!isIndexedFile(rel)) {
    // Not a note/artifact path — usually a directory. The one structural change
    // that per-file events don't cover is a *removed* directory (deleting or
    // renaming a folder). Reconcile when the path is gone — via a debounced
    // workspace reindex when the index has entries under it (a rename's notes
    // are re-homed, a delete's rows pruned); ignore directory creations/
    // renames-in (their child files reindex themselves and lazily recreate the
    // folder row).
    if (!existsSync(abs)) scheduleDirGoneReconcile(abs)
    return
  }

  // Per-path debounce: coalesces the temp+rename event pair (and rapid repeated
  // saves) into a single reconcile. Each fires as its own macrotask, so even a
  // large bulk change (git checkout) yields to the event loop between files.
  const prev = timers.get(abs)
  if (prev) clearTimeout(prev)
  timers.set(
    abs,
    setTimeout(() => {
      timers.delete(abs)
      handlePath(root, abs)
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
        watch(root, { recursive: true }, (eventType, filename) =>
          onEvent(root, eventType, filename)
        )
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
  for (const t of folderTimers.values()) clearTimeout(t)
  folderTimers.clear()
  for (const t of reindexTimers.values()) clearTimeout(t)
  reindexTimers.clear()
  for (const t of settleTimers) clearTimeout(t)
  settleTimers.clear()
  for (const w of watchers.values()) w.close()
  watchers.clear()
}
