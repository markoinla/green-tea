import { ipcMain } from 'electron'
import { resetSession } from '../agent/session'
import { getMcpManager, loadMcpConfig, saveMcpConfig, clearAuthData } from '../mcp'
import type { IpcHandlerContext } from './context'

export function registerMcpHandlers({ mainWindow }: IpcHandlerContext): void {
  ipcMain.handle('mcp:get-config', () => {
    return loadMcpConfig()
  })

  ipcMain.handle(
    'mcp:save-config',
    async (_event, config: { mcpServers: Record<string, unknown> }) => {
      saveMcpConfig(config as ReturnType<typeof loadMcpConfig>)
      getMcpManager().loadConfig()
      await resetSession()
      mainWindow?.webContents.send('mcp:changed')
    }
  )

  ipcMain.handle('mcp:get-statuses', () => {
    return getMcpManager().getServerStatuses()
  })

  ipcMain.handle('mcp:test-connection', async (_event, name: string) => {
    try {
      const manager = getMcpManager()
      manager.loadConfig()
      await manager.connect(name)
      const tools = await manager.listTools(name)
      return { success: true, toolCount: tools.length }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('mcp:disconnect', (_event, name: string) => {
    getMcpManager().disconnect(name)
    mainWindow?.webContents.send('mcp:changed')
  })

  ipcMain.handle('mcp:authenticate', async (_event, name: string) => {
    const manager = getMcpManager()
    manager.loadConfig()
    const result = await manager.authenticate(name)
    mainWindow?.webContents.send('mcp:changed')
    return result
  })

  ipcMain.handle('mcp:clear-auth', (_event, name: string) => {
    clearAuthData(name)
    getMcpManager().disconnect(name)
    mainWindow?.webContents.send('mcp:changed')
  })
}
