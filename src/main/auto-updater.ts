import { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

let currentStatus: UpdateStatus = { state: 'idle' }

function send(window: BrowserWindow, status: UpdateStatus): void {
  currentStatus = status
  window.webContents.send('app:update-status', status)
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates()
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate()
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}

export function initAutoUpdater(window: BrowserWindow): void {
  if (is.dev) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    send(window, { state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    send(window, { state: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    send(window, { state: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    send(window, { state: 'downloading', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    send(window, { state: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (err) => {
    send(window, { state: 'error', message: err.message })
  })

  // Delayed first check
  setTimeout(() => autoUpdater.checkForUpdates(), 10_000)
}
