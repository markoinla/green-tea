import { ipcMain, dialog, shell, app } from 'electron'
import { execFile } from 'child_process'
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import { getUpdateStatus, checkForUpdates, downloadUpdate, quitAndInstall } from '../auto-updater'
import { loadTheme, saveTheme } from '../theme-watcher'
import { isPythonBundled } from '../python'
import type { IpcHandlerContext } from './context'
import { getMainWindow } from './context'

export function registerSystemHandlers({ db, mainWindow }: IpcHandlerContext): void {
  ipcMain.handle('theme:get', () => loadTheme(db))
  ipcMain.handle('theme:save', (_event, data: Record<string, unknown>) => saveTheme(db, data))

  ipcMain.handle('shell:open-path', async (_event, filePath: string) => {
    return shell.openPath(filePath)
  })

  ipcMain.handle('shell:show-item-in-folder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('dialog:pick-folder', async () => {
    const window = getMainWindow(mainWindow)
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  const imagesDir = join(app.getPath('userData'), 'images')

  ipcMain.handle('images:save', (_event, filePath: string) => {
    mkdirSync(imagesDir, { recursive: true })
    const ext = extname(filePath) || '.png'
    const filename = `${randomUUID()}${ext}`
    copyFileSync(filePath, join(imagesDir, filename))
    return `gt-image://${filename}`
  })

  ipcMain.handle('images:save-from-buffer', (_event, buffer: Uint8Array, ext: string) => {
    mkdirSync(imagesDir, { recursive: true })
    const filename = `${randomUUID()}.${ext}`
    writeFileSync(join(imagesDir, filename), Buffer.from(buffer))
    return `gt-image://${filename}`
  })

  ipcMain.handle('images:pick', async () => {
    const window = getMainWindow(mainWindow)
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('files:pick-for-chat', async () => {
    const window = getMainWindow(mainWindow)
    if (!window) return []
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'All Supported',
          extensions: [
            'png',
            'jpg',
            'jpeg',
            'gif',
            'webp',
            'svg',
            'bmp',
            'pdf',
            'docx',
            'doc',
            'xlsx',
            'xls',
            'csv',
            'pptx',
            'ppt',
            'txt',
            'md',
            'json'
          ]
        },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
        {
          name: 'Documents',
          extensions: [
            'pdf',
            'docx',
            'doc',
            'xlsx',
            'xls',
            'csv',
            'pptx',
            'ppt',
            'txt',
            'md',
            'json'
          ]
        },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:update-status', () => getUpdateStatus())
  ipcMain.handle('app:check-for-updates', () => checkForUpdates())
  ipcMain.handle('app:download-update', () => downloadUpdate())
  ipcMain.handle('app:quit-and-install', () => quitAndInstall())

  ipcMain.handle(
    'app:check-python',
    () =>
      new Promise<{ installed: boolean; version?: string; bundled: boolean }>((resolve) => {
        const bundled = isPythonBundled()
        const tryCommand = (cmd: string): void => {
          execFile(cmd, ['--version'], { timeout: 5000 }, (err, stdout, stderr) => {
            if (err) {
              if (cmd === 'python3') {
                tryCommand('python')
              } else {
                resolve({ installed: false, bundled })
              }
              return
            }
            const output = (stdout || stderr).trim()
            const match = output.match(/Python\s+([\d.]+)/)
            resolve({ installed: true, version: match?.[1] ?? output, bundled })
          })
        }
        tryCommand('python3')
      })
  )

  ipcMain.handle('images:read-base64', (_event, filePath: string) => {
    const data = readFileSync(filePath).toString('base64')
    const ext = extname(filePath).toLowerCase().slice(1)
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp'
    }
    const mimeType = mimeMap[ext] || 'image/png'
    return { data, mimeType }
  })

  ipcMain.handle(
    'bug-report:submit',
    async (
      _event,
      data: { name?: string; email?: string; description: string }
    ): Promise<{ success: boolean; issue_url?: string; error?: string }> => {
      const res = await fetch('https://greentea-proxy.m-6bb.workers.dev/v1/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      const json = await res.json()
      if (!res.ok) {
        return { success: false, error: (json as { error?: string }).error || 'Request failed' }
      }
      return json as { success: boolean; issue_url?: string }
    }
  )
}
