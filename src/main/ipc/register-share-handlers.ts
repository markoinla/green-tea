import { ipcMain } from 'electron'
import type { IpcHandlerContext } from './context'
import {
  publishShare,
  publishCanvasShare,
  unpublishShare,
  getShareStatus
} from '../share/share-service'

export function registerShareHandlers({ db }: IpcHandlerContext): void {
  ipcMain.handle(
    'share:publish',
    (_event, documentId: string): Promise<{ url: string; slug: string; expiresAt: string }> =>
      publishShare(db, documentId)
  )

  // Canvas publish is two-phase: the renderer prerenders the scene to a static
  // HTML/SVG page (needs a DOM) and passes it here; this just pushes it through
  // the existing artifact share path.
  ipcMain.handle(
    'share:publishCanvas',
    (
      _event,
      documentId: string,
      entryHtml: string
    ): Promise<{ url: string; slug: string; expiresAt: string }> =>
      publishCanvasShare(db, documentId, entryHtml)
  )

  ipcMain.handle(
    'share:unpublish',
    (_event, documentId: string): Promise<void> => unpublishShare(db, documentId)
  )

  ipcMain.handle(
    'share:status',
    (
      _event,
      documentId: string
    ): { shared: boolean; url?: string; slug?: string; expiresAt?: string } =>
      getShareStatus(db, documentId)
  )
}
