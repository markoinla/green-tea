import { watch, type FSWatcher } from 'fs'
import { sep } from 'path'
import type Database from 'better-sqlite3'
import { getSettingsDir } from '../agent/paths'
import { commitSettingsChange, ensureSettingsRepo } from './settings-git'

/**
 * The global-config commit driver (Phase 4, §6). Observes the consolidated
 * `.settings/` folder for config edits — skills/, plugins/, agents/, mcp.json,
 * theme.json, written by an external editor, the agent authoring an extension, or
 * the app's own save paths — and, after an idle window, commits the whole config
 * tree to the `.settings/` repo. Mirrors plugin-watcher's module-singleton +
 * debounce + recursive-watch shape; the engine is the same one the per-workspace
 * repos use (`commitSettingsChange` → `commitAll`), just pointed at a different dir.
 *
 * Why it can't loop with itself: a commit writes ONLY under `.git/` (skipped here),
 * so the commit it makes never retriggers. And `commitAll` mints nothing when the
 * config is unchanged vs HEAD, so any spurious wakeup is a cheap no-op.
 *
 * Deliberately LOSSY, like the vault auto-committer: recursive `fs.watch` is
 * reliable only on macOS/Windows, so on Linux this never fires. That is acceptable
 * — the startup baseline commit (index.ts) still captures config, and config
 * versioning is a convenience layer, not a correctness-critical boundary.
 */

const DEBOUNCE_MS = 1_000

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let storedDb: Database.Database | null = null
let watchedDir: string | null = null

/** Skip git's own internal dir so commit writes never retrigger the watcher. */
function isGitInternalPath(relPath: string): boolean {
  return relPath.split(sep).includes('.git')
}

function flush(): void {
  debounceTimer = null
  if (!storedDb) return
  // Fire-and-forget: commitSettingsChange serializes per dir (the engine's own
  // queue) and a no-op resolves to null. Never throw into the timer.
  commitSettingsChange(storedDb, 'config: settings changed').catch((err) =>
    console.error('[git] settings auto-commit failed', err)
  )
}

function startWatchingDir(db: Database.Database): void {
  stopWatcher()

  const settingsDir = getSettingsDir(db)
  watchedDir = settingsDir

  // Recursive fs.watch is only reliable on macOS/Windows (primary target is macOS).
  if (process.platform !== 'darwin' && process.platform !== 'win32') return

  try {
    watcher = watch(settingsDir, { recursive: true }, (_eventType, filename) => {
      if (filename == null) return
      if (isGitInternalPath(filename.toString())) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(flush, DEBOUNCE_MS)
    })
  } catch {
    // Directory may not exist yet — silently ignore (ensureUserDirs creates it,
    // but guard anyway so startup never throws).
  }
}

function stopWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    watcher.close()
    watcher = null
  }
  watchedDir = null
}

/** Begin watching `.settings/` and committing config changes to its repo. */
export function startSettingsWatcher(db: Database.Database): void {
  storedDb = db
  startWatchingDir(db)
}

/**
 * Re-point the watcher after the `agentBaseDir` setting changed (the `.settings/`
 * dir moved). Mirrors restartThemeWatcher: no-op if the resolved dir is unchanged,
 * else (re)ensures the repo at the new dir and re-arms the watcher. The previous
 * dir's repo is simply left as-is on disk.
 */
export function restartSettingsWatcher(): void {
  if (!storedDb) return
  const newDir = getSettingsDir(storedDb)
  if (newDir === watchedDir) return
  ensureSettingsRepo(storedDb).catch((err) =>
    console.error('[git] settings repo init failed after base-dir change', err)
  )
  startWatchingDir(storedDb)
}

/** Stop the settings watcher and flush any pending debounced commit best-effort. */
export function stopSettingsWatcher(): void {
  const hadPending = debounceTimer !== null
  stopWatcher()
  if (hadPending) flush()
  storedDb = null
}
