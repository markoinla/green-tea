import { watch, type FSWatcher } from 'fs'
import { sep } from 'path'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { getPluginsDir } from './manager'
import { reloadPluginRegistry } from './registry'
import { reindexAllWorkspaces } from '../vault/documents-service'
import { safeSend } from '../util/safe-send'

/**
 * The plugins watcher. Observes the plugins directory (`getPluginsDir`) for files
 * added/changed/removed by an external editor or the agent authoring a new plugin,
 * and live-reloads the plugin registry so newly authored artifact viewers appear
 * WITHOUT an app restart.
 *
 * Mirrors theme-watcher's module-singleton + debounce + isDestroyed-guard shape.
 * On a debounced change it runs the SAME routine as the IPC mutation path
 * (register-plugin-handlers.ts `afterMutation`): reloadPluginRegistry(db) FIRST
 * (so the renderer's refetch of `plugins:viewers` sees the fresh cache), then
 * reindexAllWorkspaces(db), then broadcasts the EXISTING channels. The watcher is
 * a pure observer — it never writes files.
 *
 * Plugin files live in per-plugin subdirectories, so we use a single recursive
 * watcher. A SINGLE shared debounce timer coalesces the burst of events emitted by
 * a multi-file `cpSync` seed/install into exactly one reload — `reindexAllWorkspaces`
 * is comparatively expensive, so it must not run per-event. Dotfile segments (the
 * `.seeded-defaults` marker and editor temp files) are ignored so seeding never
 * triggers a reload loop.
 */

const DEBOUNCE_MS = 250

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let storedDb: Database.Database | null = null
let storedWindow: BrowserWindow | null = null

/** True when any path segment starts with '.' (dotfiles, the .seeded-defaults marker, temp files). */
function hasIgnoredSegment(relPath: string): boolean {
  for (const segment of relPath.split(sep)) {
    if (segment.startsWith('.')) return true
  }
  return false
}

function flush(): void {
  debounceTimer = null
  if (!storedDb) return
  // Rebuild the ext map + viewer cache BEFORE broadcasting so the renderer's
  // refetch of `plugins:viewers` reads the fresh cache, then reindex (a plugin's
  // extensions now map to new kinds) and notify the renderer to refetch viewers +
  // the file tree. Same routine as register-plugin-handlers.ts afterMutation().
  reloadPluginRegistry(storedDb)
  reindexAllWorkspaces(storedDb)
  safeSend(storedWindow, 'plugins:changed')
  safeSend(storedWindow, 'documents:changed')
  safeSend(storedWindow, 'folders:changed')
}

function startWatchingDir(db: Database.Database): void {
  stopWatcher()

  // Recursive fs.watch is only reliable on macOS/Windows (primary target is macOS).
  if (process.platform !== 'darwin' && process.platform !== 'win32') return

  try {
    watcher = watch(getPluginsDir(db), { recursive: true }, (_eventType, filename) => {
      if (filename == null) return
      if (hasIgnoredSegment(filename.toString())) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(flush, DEBOUNCE_MS)
    })
  } catch {
    // Directory may not exist yet — silently ignore (getPluginsDir mkdirs it,
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
}

export function startPluginWatcher(db: Database.Database, mainWindow: BrowserWindow): void {
  storedDb = db
  storedWindow = mainWindow
  startWatchingDir(db)
}

export function stopPluginWatcher(): void {
  stopWatcher()
  storedDb = null
  storedWindow = null
}
