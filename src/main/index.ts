import 'dotenv/config'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { execSync } from 'child_process'
import { app, shell, BrowserWindow, protocol, screen } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDatabase } from './database/connection'
import { registerIpcHandlers } from './ipc/handlers'
import { initAutoUpdater } from './auto-updater'
import { seedDefaultSkills } from './skills/manager'
import { ensureUserDirs } from './agent/paths'
import { seedWelcomeDocument } from './database/seed'
import { startScheduler } from './scheduler/scheduler'
import { getMcpManager } from './mcp'
import { pruneVersions } from './database/repositories/document-versions'
import {
  ensureThemeFile,
  migrateAppearanceToTheme,
  startThemeWatcher,
  stopThemeWatcher
} from './theme-watcher'
import { getPythonBinDir } from './python'

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
}

// Set app name before any getPath() calls so userData resolves to
// ~/Library/Application Support/Green Tea/ (matching productName)
app.setName('Green Tea')

// Register gt-image:// as a privileged scheme (must happen before app ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gt-image',
    privileges: {
      bypassCSP: true,
      supportFetchAPI: true,
      standard: true,
      secure: true
    }
  }
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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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

  // Ensure base user directories exist (re-creates if deleted)
  ensureUserDirs(db)

  // Ensure theme.json exists (re-creates with defaults if deleted)
  ensureThemeFile(db)

  // Migrate appearance settings from DB into theme.json (one-time)
  migrateAppearanceToTheme(db)

  // Seed bundled default skills (re-seeds if deleted)
  seedDefaultSkills(db)

  // Seed welcome document on fresh install
  seedWelcomeDocument(db)

  // Create window and register IPC handlers with window reference
  const mainWindow = createWindow()
  registerIpcHandlers(db, mainWindow)
  initAutoUpdater(mainWindow)

  // Start the task scheduler
  startScheduler(db, mainWindow)

  // Watch theme.json for live theme overrides
  startThemeWatcher(db, mainWindow)

  // Prune old document versions at startup and hourly
  pruneVersions(db)
  setInterval(() => pruneVersions(db), 60 * 60 * 1000)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  stopThemeWatcher()
  getMcpManager().disconnectAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
