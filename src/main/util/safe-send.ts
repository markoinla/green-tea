import type { BrowserWindow } from 'electron'

/**
 * Send an IPC message to a renderer only when the window is still alive.
 * No-ops when the window is missing or its webContents has been destroyed,
 * which otherwise throws 'Object has been destroyed' during teardown.
 */
export function safeSend(
  window: BrowserWindow | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(channel, ...args)
}
