import { ipcMain } from 'electron'
import {
  clearGoogleAuth,
  getAccountStatus,
  connectGoogleService,
  disconnectGoogleService
} from '../google'
import type { GoogleServiceType } from '../google'
import type { IpcHandlerContext } from './context'

export function registerGoogleHandlers({ mainWindow }: IpcHandlerContext): void {
  ipcMain.handle('google:connect-service', async (_event, service: string) => {
    const result = await connectGoogleService(service as GoogleServiceType)
    mainWindow?.webContents.send('google:changed')
    return result
  })

  ipcMain.handle('google:disconnect-service', async (_event, service: string) => {
    disconnectGoogleService(service as GoogleServiceType)
    mainWindow?.webContents.send('google:changed')
  })

  ipcMain.handle('google:clear-auth', () => {
    clearGoogleAuth()
    mainWindow?.webContents.send('google:changed')
  })

  ipcMain.handle('google:get-status', async () => {
    return await getAccountStatus()
  })
}
