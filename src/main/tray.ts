import { Tray, Menu, nativeImage } from 'electron'
import trayIcon from '../../resources/trayTemplate.png?asset'

let tray: Tray | null = null

export function createTray(onOpen: () => void, onQuit: () => void): void {
  if (tray) return
  const icon = nativeImage.createFromPath(trayIcon)
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Green Tea')
  const menu = Menu.buildFromTemplate([
    { label: 'Open Green Tea', click: onOpen },
    { type: 'separator' },
    { label: 'Quit Green Tea', click: onQuit }
  ])
  tray.setContextMenu(menu)
  tray.on('click', onOpen)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
