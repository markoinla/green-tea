import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/**
 * Tab commands sent to the renderer from application-menu accelerators. Bare
 * renderer keydowns are unreliable against the default menu (Window > Close owns
 * CmdOrCtrl+W as a non-cancelable accelerator), so tab navigation rides the menu.
 */
export type TabCommand =
  | { type: 'close' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goto'; index: number }

/**
 * Install the application menu. We build it from scratch (the default menu has
 * no idea about tabs) so we can:
 *  - rebind Window > Close to CmdOrCtrl+W → close the active tab (the renderer
 *    falls through to a real window-close when zero tabs are open);
 *  - register Cmd/Ctrl-1…9 (goto tab N, visual order) and Ctrl-Tab /
 *    Ctrl-Shift-Tab (cycle) accelerators.
 * Cmd-1…9 are hidden items: on macOS `acceleratorWorksWhenHidden` defaults to
 * true, so they fire without cluttering the menu bar.
 */
export function setupApplicationMenu(mainWindow: BrowserWindow): void {
  const isMac = process.platform === 'darwin'
  const send = (cmd: TabCommand): void => {
    mainWindow.webContents.send('menu:tab-command', cmd)
  }

  const gotoItems: MenuItemConstructorOptions[] = []
  for (let n = 1; n <= 9; n++) {
    gotoItems.push({
      label: `Go to Tab ${n}`,
      accelerator: `CmdOrCtrl+${n}`,
      visible: false,
      click: () => send({ type: 'goto', index: n - 1 })
    })
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    // NOT `role: 'fileMenu'` — on macOS that injects a "Close Window" item that
    // also owns CmdOrCtrl+W and would collide with our "Close Tab" accelerator
    // below. On macOS the appMenu already owns Quit; elsewhere add a minimal File
    // menu with just Quit.
    ...(isMac ? [] : [{ label: 'File', submenu: [{ role: 'quit' as const }] }]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => send({ type: 'close' })
        },
        { type: 'separator' },
        {
          label: 'Show Next Tab',
          accelerator: 'Control+Tab',
          click: () => send({ type: 'next' })
        },
        {
          label: 'Show Previous Tab',
          accelerator: 'Control+Shift+Tab',
          click: () => send({ type: 'prev' })
        },
        { type: 'separator' },
        { role: 'minimize' },
        ...(isMac
          ? [{ role: 'zoom' as const }, { type: 'separator' as const }, { role: 'front' as const }]
          : []),
        ...gotoItems
      ]
    },
    { role: 'help', submenu: [{ role: 'about' }] }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  // Keep the in-app menu bar hidden on Windows/Linux (matches autoHideMenuBar);
  // accelerators still fire. On macOS the menu lives in the system menu bar.
  if (!isMac) {
    mainWindow.setMenuBarVisibility(false)
  }
}
