import { ipcMain } from 'electron'
import * as settings from '../database/repositories/settings'
import * as pluginManager from '../plugins/manager'
import { fetchPluginRegistry, pluginUrl } from '../plugins/marketplace'
import { reloadPluginRegistry, getPluginViewerContributions } from '../plugins/registry'
import { reindexAllWorkspaces } from '../vault/documents-service'
import { getMainWindow } from './context'
import type { IpcHandlerContext } from './context'

export function registerPluginHandlers({ db, mainWindow }: IpcHandlerContext): void {
  // After any plugin mutation: rebuild the ext map + viewer cache, rebuild the
  // documents index (a plugin's extensions now map to new kinds), and notify the
  // renderer to refetch viewers + the file tree.
  const afterMutation = (): void => {
    reloadPluginRegistry(db)
    reindexAllWorkspaces(db)
    const win = getMainWindow(mainWindow)
    win?.webContents.send('plugins:changed')
    win?.webContents.send('documents:changed')
    win?.webContents.send('folders:changed')
  }

  ipcMain.handle('plugins:list', () => {
    return pluginManager.listInstalledPlugins(db).map((p) => ({
      id: p.id,
      manifest: p.manifest,
      dir: p.dir,
      enabled: p.enabled,
      name: p.manifest.name
    }))
  })

  ipcMain.handle('plugins:install', async (_event, url: string) => {
    const plugin = await pluginManager.installPluginFromUrl(db, url)
    afterMutation()
    return {
      id: plugin.id,
      manifest: plugin.manifest,
      dir: plugin.dir,
      enabled: plugin.enabled,
      name: plugin.manifest.name
    }
  })

  ipcMain.handle('plugins:remove', (_event, id: string) => {
    pluginManager.removePlugin(db, id)
    const disabledRaw = settings.getSetting(db, 'disabledPlugins')
    const disabled: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
    const updated = disabled.filter((p) => p !== id)
    settings.setSetting(db, 'disabledPlugins', JSON.stringify(updated))
    afterMutation()
  })

  ipcMain.handle('plugins:toggle', (_event, id: string, enabled: boolean) => {
    const disabledRaw = settings.getSetting(db, 'disabledPlugins')
    const disabled: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
    let updated: string[]
    if (enabled) {
      updated = disabled.filter((p) => p !== id)
    } else {
      updated = disabled.includes(id) ? disabled : [...disabled, id]
    }
    settings.setSetting(db, 'disabledPlugins', JSON.stringify(updated))
    afterMutation()
  })

  ipcMain.handle('plugins:marketplace:list', async () => {
    const entries = await fetchPluginRegistry()
    return entries.map((e) => ({ ...e, url: pluginUrl(e) }))
  })

  ipcMain.handle('plugins:marketplace:refresh', async () => {
    const entries = await fetchPluginRegistry(true)
    return entries.map((e) => ({ ...e, url: pluginUrl(e) }))
  })

  ipcMain.handle('plugins:viewers', () => {
    return getPluginViewerContributions(db)
  })
}
