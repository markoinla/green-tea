import { ipcMain } from 'electron'
import { connectLlmProvider, disconnectLlmProvider, getLlmAccountStatus } from '../llm-auth'
import type { IpcHandlerContext } from './context'

/**
 * IPC for connecting LLM subscription accounts (Claude Pro/Max, ChatGPT Codex)
 * via OAuth from Settings → Accounts. Credentials persist to the encrypted
 * secrets store; the agent picks them up when the matching provider is selected.
 */
export function registerLlmAuthHandlers({ mainWindow }: IpcHandlerContext): void {
  ipcMain.handle('llm-auth:connect', async (_event, providerId: string) => {
    const result = await connectLlmProvider(providerId)
    mainWindow?.webContents.send('llm-auth:changed')
    return result
  })

  ipcMain.handle('llm-auth:disconnect', (_event, providerId: string) => {
    disconnectLlmProvider(providerId)
    mainWindow?.webContents.send('llm-auth:changed')
  })

  ipcMain.handle('llm-auth:get-status', () => {
    return getLlmAccountStatus()
  })
}
