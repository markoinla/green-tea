import { dialog, ipcMain } from 'electron'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import * as workspaceFiles from '../database/repositories/workspace-files'
import type { IpcHandlerContext } from './context'
import { getMainWindow } from './context'

export function registerWorkspaceFileHandlers({ db }: IpcHandlerContext): void {
  ipcMain.handle('db:workspace-files:list', (_event, workspaceId: string) => {
    return workspaceFiles.listWorkspaceFiles(db, workspaceId)
  })

  ipcMain.handle(
    'db:workspace-files:add',
    (_event, data: { workspace_id: string; file_path: string; file_name: string }) => {
      const file = workspaceFiles.addWorkspaceFile(db, data)
      _event.sender.send('workspace-files:changed')
      return file
    }
  )

  ipcMain.handle('db:workspace-files:remove', (_event, id: string) => {
    workspaceFiles.removeWorkspaceFile(db, id)
    _event.sender.send('workspace-files:changed')
  })

  ipcMain.handle('db:workspace-files:resolve-paths', (_event, paths: string[]) => {
    const resolved: string[] = []
    const walkDir = (dirPath: string): void => {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const fullPath = join(dirPath, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath)
        } else if (entry.isFile()) {
          resolved.push(fullPath)
        }
      }
    }
    for (const p of paths) {
      try {
        if (statSync(p).isDirectory()) {
          walkDir(p)
        } else {
          resolved.push(p)
        }
      } catch {
        // Skip inaccessible paths
      }
    }
    return resolved
  })

  ipcMain.handle('db:workspace-files:pick', async () => {
    const window = getMainWindow()
    if (!window) return []
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'All Supported Files',
          extensions: ['docx', 'pdf', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'txt', 'md', 'json']
        },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  })
}
