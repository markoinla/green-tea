import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import { marked } from 'marked'
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

  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    // Restrict to web URLs so a renderer can't drive the OS into opening
    // arbitrary protocol handlers (file:, etc.).
    if (!/^https?:\/\//i.test(url)) return
    await shell.openExternal(url)
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
      data: { type?: 'bug' | 'feedback'; name?: string; email?: string; description: string }
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

  // Render the document's markdown to a PDF via a hidden, offscreen BrowserWindow
  // (so only the document content is exported, not the surrounding app chrome),
  // then save it through a native dialog.
  ipcMain.handle(
    'export:pdf',
    async (
      _event,
      args: { markdown: string; title: string }
    ): Promise<{ saved: boolean; filePath?: string }> => {
      const window = getMainWindow(mainWindow)
      if (!window) return { saved: false }

      const result = await dialog.showSaveDialog(window, {
        defaultPath: `${args.title || 'Untitled'}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return { saved: false }

      const body = await marked.parse(args.markdown)
      // Escape the title for the <title> element — without it, Chrome's printToPDF
      // falls back to the document URL (the `data:text/html,…` below) as the PDF's
      // embedded title, which then shows in PDF viewers' toolbars.
      const escapeHtml = (s: string): string =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
      const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(args.title || 'Untitled')}</title><style>
        html { -webkit-print-color-adjust: exact; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          font-size: 12px;
          line-height: 1.6;
          color: #1a1a1a;
          margin: 0;
          padding: 0;
        }
        h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 0.5em; }
        h1 { font-size: 2em; }
        h2 { font-size: 1.5em; }
        h3 { font-size: 1.25em; }
        p { margin: 0.6em 0; }
        ul, ol { padding-left: 1.5em; }
        code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 0.9em;
          background: #f4f4f4;
          padding: 0.1em 0.3em;
          border-radius: 3px;
        }
        pre { background: #f4f4f4; padding: 0.8em; border-radius: 5px; overflow-x: auto; }
        pre code { background: none; padding: 0; }
        blockquote {
          margin: 0.8em 0;
          padding-left: 1em;
          border-left: 3px solid #ddd;
          color: #555;
        }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 0.4em 0.6em; text-align: left; }
        img { max-width: 100%; }
        a { color: #0b6bcb; }
      </style></head><body>${body}</body></html>`

      const exportWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      try {
        await exportWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        const data = await exportWindow.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { marginType: 'default' }
        })
        writeFileSync(result.filePath, data)
      } finally {
        exportWindow.destroy()
      }

      return { saved: true, filePath: result.filePath }
    }
  )
}
