import { ipcMain, session } from 'electron'
import { GT_PLUGIN_SCHEME } from '../protocol/gt-plugin'
import * as settings from '../database/repositories/settings'
import * as pluginManager from '../plugins/manager'
import { fetchPluginRegistry, pluginUrl } from '../plugins/marketplace'
import { reloadPluginRegistry, getPluginViewerContributions } from '../plugins/registry'
import { pluginSecretKey, pluginSecretPrefix, sanitizePluginSubKey } from '../plugins/secret-key'
import { reindexAllWorkspaces } from '../vault/documents-service'
import { getSecret, setSecret, deleteSecret, listSecretKeys } from '../secrets'
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

  ipcMain.handle('plugins:remove', async (_event, id: string) => {
    pluginManager.removePlugin(db, id)
    const disabledRaw = settings.getSetting(db, 'disabledPlugins')
    const disabled: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
    const updated = disabled.filter((p) => p !== id)
    settings.setSetting(db, 'disabledPlugins', JSON.stringify(updated))
    // Plugin viewers run at the `gt-plugin://<id>` origin (allow-same-origin), so
    // they may have accumulated persistent web storage. Reclaim it on uninstall —
    // the on-disk dir is already gone, but storage is keyed by origin, not path.
    await session.defaultSession
      .clearStorageData({ origin: `${GT_PLUGIN_SCHEME}://${id}` })
      .catch((err: unknown) => console.error('[plugin] storage cleanup failed', err))
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

  // --- Plugin-scoped secrets (§4.9.1) ---------------------------------------
  // PluginViewer (trusted renderer) forwards these on behalf of its sandboxed
  // iframe, passing the pluginId it sourced from its own unforgeable
  // contribution.pluginId. We DO NOT trust that blindly: server-side we look the
  // plugin up in the trusted registry, reject if missing/disabled, and require the
  // "secrets" permission from its on-disk manifest. The storage key is ALWAYS built
  // here as `plugin:<pluginId>:<subKey>`, so a plugin can never read `google`,
  // `mcp:*`, or another plugin's namespace — even a subKey containing `:` stays
  // within its own prefix.
  const requireSecretsPlugin = (pluginId: unknown): string => {
    if (typeof pluginId !== 'string') throw new Error('Invalid pluginId')
    const plugin = pluginManager.listInstalledPlugins(db).find((p) => p.id === pluginId)
    if (!plugin || !plugin.enabled) {
      throw new Error(`Plugin "${pluginId}" is not installed or is disabled`)
    }
    const perms = plugin.manifest.permissions
    if (!Array.isArray(perms) || !perms.includes('secrets')) {
      throw new Error(`Plugin "${pluginId}" has not declared the "secrets" permission`)
    }
    return pluginId
  }

  ipcMain.handle('plugins:secret:get', (_event, pluginId: string, subKey: string) => {
    const id = requireSecretsPlugin(pluginId)
    return getSecret(db, pluginSecretKey(id, sanitizePluginSubKey(subKey)))
  })

  ipcMain.handle(
    'plugins:secret:set',
    (_event, pluginId: string, subKey: string, value: string) => {
      const id = requireSecretsPlugin(pluginId)
      if (typeof value !== 'string') throw new Error('Secret value must be a string')
      setSecret(db, pluginSecretKey(id, sanitizePluginSubKey(subKey)), value)
    }
  )

  ipcMain.handle('plugins:secret:delete', (_event, pluginId: string, subKey: string) => {
    const id = requireSecretsPlugin(pluginId)
    deleteSecret(db, pluginSecretKey(id, sanitizePluginSubKey(subKey)))
  })

  ipcMain.handle('plugins:secret:list', (_event, pluginId: string) => {
    const id = requireSecretsPlugin(pluginId)
    const prefix = pluginSecretPrefix(id)
    return listSecretKeys(db, prefix).map((k) => k.slice(prefix.length))
  })
}
