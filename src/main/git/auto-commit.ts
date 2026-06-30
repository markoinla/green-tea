import { commitPaths, APP_IDENTITY } from './git-service'

/**
 * Debounced auto-commit (Phase 2, §4.5 trigger 1) — the continuous, Time-Machine-like
 * safety net. The vault-watcher feeds it the absolute paths it just saw change; after
 * an idle interval per workspace it commits EXACTLY those paths (scoped staging via
 * `commitPaths`, never a full-tree `git status` scan) so it stays fast on large vaults.
 *
 * Why it can't loop with the watcher: every commit writes only under `.git/` (which the
 * watcher ignores) — `commitPaths` re-hashes the dirty files but never rewrites them.
 * The one tracked file a fresh `ensureRepo` writes (`.gitignore`) is self-write-marked,
 * so even that doesn't echo back. And self-writes (our own atomic saves / restores) are
 * consumed by the watcher BEFORE it ever calls `recordDirtyPath`, so app writes don't
 * feed this loop either — only external edits and agent patches do, which is the point.
 *
 * This is a deliberately LOSSY safety net (the watcher is debounced, extension-filtered,
 * and disabled on Linux): correctness-critical commits go through the before-agent-patch
 * boundary and the agent turn-end whole-tree reconcile instead (workspace-git.ts).
 */

/** Idle window after the last dirty path before the batch is committed. */
const DEFAULT_IDLE_MS = 30_000
let idleMs = DEFAULT_IDLE_MS

let stopped = true

/** repo dir → set of absolute dirty paths awaiting commit. */
const pending = new Map<string, Set<string>>()
/** repo dir → idle timer. */
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function commitDir(dir: string): void {
  const paths = pending.get(dir)
  if (!paths || paths.size === 0) return
  pending.delete(dir)
  const list = [...paths]
  const message = `autosave: ${list.length} file${list.length === 1 ? '' : 's'}`
  // Fire-and-forget: commitPaths serializes per dir (its own queue) and never throws
  // into the caller; a no-op (nothing actually changed vs HEAD) resolves to null.
  commitPaths(dir, list, message, APP_IDENTITY).catch((err) =>
    console.error('[git] auto-commit failed for', dir, err)
  )
}

/**
 * Note that `absPath` (under workspace folder `dir`) changed on disk and (re)arm the
 * per-dir idle timer. Called by the vault-watcher on a real create/update/delete of a
 * tracked file. No-op while stopped (during teardown/quit).
 */
export function recordDirtyPath(dir: string, absPath: string): void {
  if (stopped) return
  let set = pending.get(dir)
  if (!set) {
    set = new Set()
    pending.set(dir, set)
  }
  set.add(absPath)
  const prev = timers.get(dir)
  if (prev) clearTimeout(prev)
  timers.set(
    dir,
    setTimeout(() => {
      timers.delete(dir)
      if (stopped) return
      commitDir(dir)
    }, idleMs)
  )
}

/** Enable the debounced auto-committer. */
export function startAutoCommit(): void {
  stopped = false
}

/**
 * Disable the auto-committer and flush any pending batches best-effort. On a clean
 * quit the flush kicks off the final commits; anything that doesn't finish before the
 * process exits is caught by the next startup / agent turn-end reconcile, so no edit is
 * lost — just deferred.
 */
export function stopAutoCommit(): void {
  stopped = true
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  for (const dir of [...pending.keys()]) commitDir(dir)
}

/** Test-only: shrink the idle window so debounce can be exercised with real timers. */
export function setAutoCommitIdleForTest(ms: number): void {
  idleMs = ms
}

/** Test-only: reset module state (timers, pending set, idle window, stopped flag). */
export function __resetAutoCommitForTest(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  pending.clear()
  idleMs = DEFAULT_IDLE_MS
  stopped = true
}
