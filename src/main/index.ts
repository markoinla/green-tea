import 'dotenv/config'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { app, shell, BrowserWindow, protocol, screen, ipcMain, Notification } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDatabase } from './database/connection'
import { registerIpcHandlers } from './ipc/handlers'
import { setupApplicationMenu } from './menu'
import { initAutoUpdater } from './auto-updater'
import { seedDefaultSkills } from './skills/manager'
import { ensureUserDirs } from './agent/paths'
import { reindexAllWorkspaces } from './vault/documents-service'
import { migrateGlobalConfigToSettings, migrateLegacyVaultLayout } from './vault/paths'
import { startVaultWatcher, stopVaultWatcher } from './vault/vault-watcher'
import { ensureWorkspaceDocs } from './vault/workspace-docs'
import { backfillWorkspaceDocs } from './database/migrations'
import { listWorkspaces } from './database/repositories/workspaces'
import { ensureWorkspaceRepo } from './git/workspace-git'
import { startAutoCommit, stopAutoCommit } from './git/auto-commit'
import { ensureSettingsRepo, commitSettingsChange } from './git/settings-git'
import { startSettingsWatcher, stopSettingsWatcher } from './git/settings-watcher'
import { startPluginWatcher, stopPluginWatcher } from './plugins/watcher'
import { seedDefaultWorkspace } from './database/seed'
import { startScheduler } from './scheduler/scheduler'
import { getMcpManager } from './mcp'
import { countEnabledScheduledTasks } from './database/repositories/scheduled-tasks'
import { getSetting, setSetting } from './database/repositories/settings'
import { createTray } from './tray'
import {
  ensureThemeFile,
  migrateAppearanceToTheme,
  startThemeWatcher,
  stopThemeWatcher
} from './theme-watcher'
import { getPythonBinDir, getPythonUserBaseDir, getPythonUserBinDir } from './python'
import { GT_FILE_SCHEME, GT_FILE_PRIVILEGE, createGtFileHandler } from './protocol/gt-file'
import { GT_PLUGIN_SCHEME, GT_PLUGIN_PRIVILEGE, createGtPluginHandler } from './protocol/gt-plugin'
import { reEncryptPlaintextSecrets } from './secrets'
import { migrateOAuthSecrets } from './secrets/migrate-oauth'
import { seedDefaultPlugins } from './plugins/manager'
import { reloadPluginRegistry } from './plugins/registry'
import { isQuitting, markQuitting } from './util/quit-state'

// Fix PATH for macOS/Linux — Electron launched from the dock gets a minimal
// PATH that excludes nvm, homebrew, etc. Fetch the real shell PATH so spawned
// processes (e.g. MCP servers using npx) can resolve binaries correctly.
if (process.platform !== 'win32') {
  try {
    const userShell = process.env.SHELL || '/bin/zsh'
    const shellPath = execSync(`${userShell} -ilc 'echo -n $PATH'`, {
      encoding: 'utf-8',
      timeout: 3000
    })
    if (shellPath) {
      process.env.PATH = shellPath
    }
  } catch {
    // Keep the existing PATH if shell invocation fails
  }
}

// Prepend bundled Python to PATH so agent bash commands find it automatically.
const pythonBinDir = getPythonBinDir()
if (pythonBinDir) {
  const sep = process.platform === 'win32' ? ';' : ':'
  process.env.PATH = `${pythonBinDir}${sep}${process.env.PATH}`

  // Make runtime `pip install` work despite the interpreter living in the
  // read-only app bundle: route installs to a writable user base and let the
  // bundled interpreter auto-add its site-packages to sys.path.
  // - PIP_USER=1            → every `pip install` behaves like `--user`
  // - PYTHONUSERBASE        → where --user installs land (and import from)
  // - PIP_NO_CACHE_DIR      → don't write to ~/.cache (outside the sandbox)
  // The sandbox grants write to this same dir (see sandbox.ts defaultConfig).
  const pythonUserBase = getPythonUserBaseDir()
  try {
    mkdirSync(pythonUserBase, { recursive: true })
  } catch {
    // Non-fatal — pip will surface a clear error if the dir is unwritable.
  }
  process.env.PYTHONUSERBASE = pythonUserBase
  process.env.PIP_USER = '1'
  process.env.PIP_NO_CACHE_DIR = '1'
  process.env.PIP_DISABLE_PIP_VERSION_CHECK = '1'
  // Console scripts from --user installs live here; put them on PATH too.
  process.env.PATH = `${getPythonUserBinDir()}${sep}${process.env.PATH}`
}

// Set app name before any getPath() calls so userData resolves to
// ~/Library/Application Support/Green Tea/ (matching productName)
app.setName('Green Tea')

// Register gt-image:// and gt-file:// as privileged schemes (must happen before app ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gt-image',
    privileges: {
      bypassCSP: true,
      supportFetchAPI: true,
      standard: true,
      secure: true
    }
  },
  GT_FILE_PRIVILEGE,
  GT_PLUGIN_PRIVILEGE
])

function createWindow(): BrowserWindow {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  const width = Math.round(screenWidth * 0.8)
  const height = Math.round(screenHeight * 0.8)

  const mainWindow = new BrowserWindow({
    width,
    height,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegrationInSubFrames: false,
      plugins: true // enable Chromium's bundled PDF viewer for gt-file:// iframes
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Only hand off http(s) URLs to the OS browser. Any other scheme
    // (file:, gt-file:, javascript:, etc.) is denied without opening.
    let protocolStr: string | null = null
    try {
      protocolStr = new URL(details.url).protocol
    } catch {
      protocolStr = null
    }
    if (protocolStr === 'http:' || protocolStr === 'https:') {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Serve images from userData/images/ via gt-image:// protocol
  const imagesDir = join(app.getPath('userData'), 'images')
  protocol.handle('gt-image', async (request) => {
    const url = new URL(request.url)
    const filename = decodeURIComponent(url.hostname || url.pathname.replace(/^\/+/, ''))
    const filePath = join(imagesDir, filename)
    try {
      const data = await readFile(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp'
      }
      return new Response(data, {
        headers: { 'Content-Type': mimeMap[ext] ?? 'application/octet-stream' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  // Initialize database
  const db = getDatabase()

  // Serve HTML artifacts and their sibling assets via gt-file:// protocol.
  // Traversal-guarded + CSP-headed; see src/main/protocol/gt-file.ts.
  protocol.handle(GT_FILE_SCHEME, createGtFileHandler(db))

  // Serve plugin viewer assets via gt-plugin://<id>/ protocol.
  // Traversal-guarded + CSP-headed; see src/main/protocol/gt-plugin.ts.
  protocol.handle(GT_PLUGIN_SCHEME, createGtPluginHandler(db))

  // Phase 00 (§4.9): relocate plaintext OAuth tokens into the encrypted secrets
  // store. Runs synchronously HERE — after getDatabase() (schema ready) and after
  // app 'ready' (safeStorage usable), but BEFORE registerIpcHandlers/createWindow
  // so integrations read tokens from the store. reEncrypt first so any prior
  // plaintext-fallback rows are upgraded before the migration's unlink pass
  // considers them secure. Wrapped so any failure degrades to "not yet migrated"
  // (retried next launch), mirroring migrateLegacyVaultLayout below.
  try {
    reEncryptPlaintextSecrets(db)
    migrateOAuthSecrets(db)
  } catch (err) {
    console.error('[secrets] OAuth migration failed', err)
  }

  // One-time: move notes from the old `vaults/` tree into the unified
  // `workspaces/` tree. Runs before ensureUserDirs so it can rename the whole
  // tree when the target doesn't exist yet. Guarded so a filesystem error
  // (e.g. EXDEV across mounts) degrades to "notes not yet moved" rather than
  // blocking startup; reindex below picks up whatever did land in workspaces/.
  try {
    migrateLegacyVaultLayout(db)
  } catch (err) {
    console.error('[migration] legacy vault layout move failed', err)
  }

  // Phase 0 (§4.2/§6): consolidate the global config items
  // {skills, plugins, agents, mcp.json, theme.json} under `<base>/.settings/`.
  // CRITICAL STARTUP ORDERING: this runs HERE, at the migrateLegacyVaultLayout
  // slot, BEFORE ensureUserDirs (and before seedDefaultPlugins/reloadPluginRegistry,
  // ensureThemeFile/migrateAppearanceToTheme, seedDefaultSkills, and the first
  // lazy loadMcpConfig at session/IPC time) — all of which create the
  // `.settings/<item>` destinations. Running first keeps those destinations absent
  // so each item takes the atomic whole-tree rename path instead of the
  // never-overwrite merge path. Allowlist-only, non-destructive, idempotent with no
  // global flag (self-heals on a later launch), mirroring migrateLegacyVaultLayout
  // above; guarded so a filesystem error degrades to "not yet moved".
  try {
    migrateGlobalConfigToSettings(db)
  } catch (err) {
    console.error('[migration] global config -> .settings move failed', err)
  }

  // Ensure base user directories exist (re-creates if deleted). Runs AFTER the
  // .settings consolidation above so it (re)creates `.settings/skills` etc. only
  // once the move has had its chance to relocate any legacy content into them.
  ensureUserDirs(db)

  // Seed bundled default plugins (re-seeds if deleted) and build the plugin
  // registry (ext map + viewer cache). Must run BEFORE reindexAllWorkspaces so
  // the plugin extension map is populated when the index walk classifies files.
  seedDefaultPlugins(db)
  reloadPluginRegistry(db)

  // One-time DB->file backfill of README.md / MEMORY.md
  // from the legacy `workspaces.description` / `workspaces.memory` columns. MUST
  // run AFTER migrateLegacyVaultLayout + ensureUserDirs (so each workspace folder
  // is already at its final location) and BEFORE reindexAllWorkspaces (so the
  // backfilled files get indexed this session). One-shot-guarded internally.
  backfillWorkspaceDocs(db)

  // Ensure each workspace has its README.md / MEMORY.md
  // present at the workspace root, recreating them EMPTY if deleted (create-only;
  // never restores old content). Runs BEFORE reindexAllWorkspaces so a recreated
  // file is indexed/visible this session (not only after the next restart).
  // Defensive per-workspace so a single bad folder never blocks startup.
  for (const ws of listWorkspaces(db)) {
    try {
      ensureWorkspaceDocs(db, ws.id)
    } catch (err) {
      console.error('[workspace-docs] ensure failed for workspace', ws.id, err)
    }
  }

  // Rebuild the derived documents index from the markdown files on disk
  // (files are the source of truth; the SQLite rows are a disposable cache).
  reindexAllWorkspaces(db)

  // Ensure each present workspace folder is a git repo (+ managed .gitignore) for
  // vault-wide version history (Phase 1). Idempotent and serialized per dir;
  // fire-and-forget per workspace so a single bad folder never blocks startup.
  for (const ws of listWorkspaces(db)) {
    ensureWorkspaceRepo(db, ws.id).catch((err) =>
      console.error('[git] ensureRepo failed at startup for workspace', ws.id, err)
    )
  }

  // Global-config repo (Phase 4, §4.1/§6): a DISTINCT git repo rooted at the
  // consolidated `.settings/` folder (never nested in/merged with a workspace
  // repo). Init it (+ config-only `.gitignore`), then commit a baseline so the
  // current skills/plugins/agents/mcp.json/theme.json state is captured on first
  // launch. Both are idempotent (commit is a no-op once HEAD matches); ongoing
  // config edits are committed by the settings watcher below. Fire-and-forget so a
  // git error never blocks startup. ensureUserDirs above already created the dir.
  ensureSettingsRepo(db)
    .then(() => commitSettingsChange(db, 'config: initial import'))
    .catch((err) => console.error('[git] settings repo init/baseline failed at startup', err))

  // Ensure theme.json exists (re-creates with defaults if deleted)
  ensureThemeFile(db)

  // Migrate appearance settings from DB into theme.json (one-time)
  migrateAppearanceToTheme(db)

  // Seed bundled default skills (re-seeds if deleted)
  seedDefaultSkills(db)

  // Seed the bundled starter content into the default workspace on fresh install
  seedDefaultWorkspace(db)

  // Create window and register IPC handlers with window reference
  const mainWindow = createWindow()
  setupApplicationMenu(mainWindow)
  registerIpcHandlers(db, mainWindow)
  initAutoUpdater(mainWindow)

  // Auto-connect enabled MCP servers on startup so their tools are ready and the
  // settings UI shows them connected instead of all-disconnected. Fire-and-forget
  // so a slow or broken server never blocks startup; broadcast once the batch
  // settles so the renderer's status dots refresh.
  getMcpManager()
    .autoConnect()
    .then(() => mainWindow.webContents.send('mcp:changed'))
    .catch((err) => console.error('[mcp] startup auto-connect failed', err))

  // Go resident in the menu bar: create the tray (lazily, on first hide) and,
  // the first time only, post a one-time notice so the user knows the app is
  // still running in the background.
  const ensureResident = (): void => {
    createTray(
      () => mainWindow.show(),
      () => {
        markQuitting()
        app.quit()
      }
    )
    if (getSetting(db, 'residentNoticeShown') !== 'true') {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Green Tea is still running',
          body: 'Scheduled tasks keep working in the background. Quit anytime from the menu-bar icon.'
        }).show()
      }
      setSetting(db, 'residentNoticeShown', 'true')
    }
  }

  // Close interceptor: on macOS, when we're not really quitting, always hide the
  // window instead of closing it so the single window is never destroyed (a
  // recreated window would be orphaned — no close interceptor, IPC, menu, or
  // scheduler wiring). We only go resident (tray + one-time notice) when there
  // is ≥1 enabled scheduled task that needs the app to keep running in the
  // background; with 0 tasks the window simply hides and a dock-click re-shows
  // it. createWindow lacks `db`, so this lives here.
  mainWindow.on('close', (event) => {
    if (isQuitting()) return
    if (process.platform !== 'darwin') return
    event.preventDefault()
    // Hiding a window that's in its own macOS fullscreen Space leaves a black
    // screen — exit fullscreen first, then hide once the transition finishes.
    if (mainWindow.isFullScreen()) {
      mainWindow.once('leave-full-screen', () => mainWindow.hide())
      mainWindow.setFullScreen(false)
    } else {
      mainWindow.hide()
    }
    if (countEnabledScheduledTasks(db) > 0) ensureResident()
  })

  // Quit-flush handshake: on an explicit quit (Cmd-Q), give the renderer a bounded
  // chance to flush pending autosaves + tab state before we exit. This is the
  // guarantee that the renderer `beforeunload` (best-effort, can't await) is not.
  // Window-close on macOS leaves the window destroyed here, so we just quit.
  let flushedBeforeQuit = false
  app.on('before-quit', (event) => {
    // Safety net: a genuine quit must never be blocked by the close interceptor.
    markQuitting()
    if (flushedBeforeQuit) return
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    event.preventDefault()
    flushedBeforeQuit = true
    const finish = (): void => app.quit()
    const timer = setTimeout(finish, 1500)
    ipcMain.once('app:flush-done', () => {
      clearTimeout(timer)
      finish()
    })
    mainWindow.webContents.send('app:flush-before-quit')
  })

  // Start the task scheduler
  startScheduler(db, mainWindow)

  // Watch theme.json for live theme overrides
  startThemeWatcher(db, mainWindow)

  // Debounced git auto-commit (Phase 2, §4.5): the vault-watcher feeds it dirty
  // paths; after an idle window it commits exactly those files as a safety net.
  // Started before the watcher so no early dirty event is dropped.
  startAutoCommit()

  // Watch the vault for external .md changes (Phase 5): external editors,
  // Obsidian, sync, or the agent writing files → live-reload the open note.
  startVaultWatcher(db, mainWindow)

  // Watch the plugins directory for hot-reload: when plugin files are added,
  // changed, or removed (external editor or the agent authoring a plugin),
  // rebuild the plugin registry and notify the renderer so new artifact viewers
  // appear without an app restart.
  startPluginWatcher(db, mainWindow)

  // Watch `.settings/` and commit config changes to the global-config repo
  // (Phase 4, §6): skills/plugins/agents/mcp.json/theme.json edits → a debounced
  // commit. Same engine as the vault auto-committer, pointed at `.settings/`.
  startSettingsWatcher(db)

  app.on('activate', function () {
    // On macOS, dock-click fires `activate`. The close interceptor hides rather
    // than destroys the window, so it is always still around — just re-show it.
    // We deliberately do NOT recreate via createWindow() here: a fresh window
    // would be orphaned (no close interceptor, IPC handlers, menu, or scheduler
    // window ref), so showing nothing is safer than a non-functional window.
    if (!mainWindow.isDestroyed()) mainWindow.show()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  stopThemeWatcher()
  stopVaultWatcher()
  stopAutoCommit()
  stopSettingsWatcher()
  stopPluginWatcher()
  getMcpManager().disconnectAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
