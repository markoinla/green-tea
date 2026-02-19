import { ipcMain } from 'electron'
import {
  clearMicrosoftAuth,
  getMicrosoftAccountStatus,
  connectMicrosoftService,
  disconnectMicrosoftService
} from '../microsoft'
import type { MicrosoftServiceType } from '../microsoft'
import type { IpcHandlerContext } from './context'

export function registerMicrosoftHandlers({ mainWindow }: IpcHandlerContext): void {
  ipcMain.handle('microsoft:connect-service', async (_event, service: string) => {
    const result = await connectMicrosoftService(service as MicrosoftServiceType)
    mainWindow?.webContents.send('microsoft:changed')
    return result
  })

  ipcMain.handle('microsoft:disconnect-service', async (_event, service: string) => {
    disconnectMicrosoftService(service as MicrosoftServiceType)
    mainWindow?.webContents.send('microsoft:changed')
  })

  ipcMain.handle('microsoft:clear-auth', () => {
    clearMicrosoftAuth()
    mainWindow?.webContents.send('microsoft:changed')
  })

  ipcMain.handle('microsoft:get-status', async () => {
    return await getMicrosoftAccountStatus()
  })
}
