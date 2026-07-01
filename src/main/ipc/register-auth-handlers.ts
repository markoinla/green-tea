import { app, ipcMain, type BrowserWindow } from 'electron'
import { signIn, sendMagicLink, signOut, getAccount } from '../auth/account'
import type { AccountUser } from '../../shared/share-contract'
import type { IpcHandlerContext } from './context'

/**
 * Pull Green Tea back to the foreground after an external-browser sign-in. This
 * is the reliable half of "closing the popup": the OS-launched browser window
 * can't be programmatically closed (Chrome only lets scripts close windows they
 * opened), so instead we steal focus back to the app — the pattern gcloud /
 * GitHub CLI / Linear use. The success page still best-effort `window.close()`s.
 */
function focusApp(mainWindow: BrowserWindow | null | undefined): void {
  try {
    if (process.platform === 'darwin') app.focus({ steal: true })
    mainWindow?.show()
    mainWindow?.focus()
  } catch {
    // focus is best-effort; never let it break sign-in
  }
}

/**
 * Marketplace account IPC (auth layer one). Mirrors `register-google-handlers.ts`:
 * a small set of `auth:*` channels plus an `auth:changed` broadcast that hooks
 * subscribe to for reactive sign-in/out updates. No launch gating — the app is
 * fully functional with no account.
 */
export function registerAuthHandlers({ db, mainWindow }: IpcHandlerContext): void {
  ipcMain.handle(
    'auth:sign-in',
    async (): Promise<{ success: true; user: AccountUser } | { success: false; error: string }> => {
      const result = await signIn(db)
      if (result.success) focusApp(mainWindow)
      mainWindow?.webContents.send('auth:changed')
      return result
    }
  )

  ipcMain.handle(
    'auth:send-magic-link',
    async (_event, email: string): Promise<{ success: boolean; error?: string }> => {
      return sendMagicLink(db, email, () => {
        mainWindow?.webContents.send('auth:changed')
        focusApp(mainWindow)
      })
    }
  )

  ipcMain.handle('auth:sign-out', async (): Promise<{ revoked: boolean }> => {
    const result = await signOut(db)
    mainWindow?.webContents.send('auth:changed')
    return result
  })

  ipcMain.handle('auth:get-account', async (): Promise<AccountUser | null> => {
    return getAccount(db)
  })
}
