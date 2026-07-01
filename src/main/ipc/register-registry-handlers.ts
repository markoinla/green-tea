import { ipcMain } from 'electron'
import type { PublishRegistryRequest } from '../../shared/share-contract'
import * as registryClient from '../registry/client'
import { publishLocalItem, type PublishLocalOptions } from '../registry/publish-local'
import { reloadPluginRegistry } from '../plugins/registry'
import { reindexAllWorkspaces } from '../vault/documents-service'
import { resetSession } from '../agent/session'
import { getMainWindow } from './context'
import type { IpcHandlerContext } from './context'

/**
 * Community plugin & skill registry IPC (`registry:*`), mirroring the
 * register-plugin-handlers / register-skills-handlers shape. Publishing is a
 * manual UI action only — none of this is ever exposed as an agent tool.
 */
export function registerRegistryHandlers({ db, mainWindow }: IpcHandlerContext): void {
  // Identical post-install work to register-plugin-handlers' afterMutation: a
  // registry plugin install changes the ext map, the documents index and the
  // agent's loaded skill set exactly like a URL install does.
  const afterPluginMutation = (): void => {
    reloadPluginRegistry(db)
    reindexAllWorkspaces(db)
    void resetSession().catch((err: unknown) =>
      console.error('[registry] session reset after install failed', err)
    )
    const win = getMainWindow(mainWindow)
    win?.webContents.send('plugins:changed')
    win?.webContents.send('documents:changed')
    win?.webContents.send('folders:changed')
    win?.webContents.send('skills:changed')
  }

  ipcMain.handle('registry:search', (_event, opts?: registryClient.RegistrySearchOptions) => {
    return registryClient.searchRegistry(db, opts)
  })

  // Not-found is an expected answer here (the publish dialog probes for a
  // prior publish), so it comes back as null instead of an IPC rejection —
  // Electron logs every rejected handler to the console as an error.
  ipcMain.handle('registry:item', async (_event, itemId: string) => {
    try {
      return await registryClient.getRegistryItem(db, itemId)
    } catch (err) {
      if (err instanceof registryClient.RegistryRequestError && err.status === 404) return null
      throw err
    }
  })

  ipcMain.handle('registry:publish', (_event, request: PublishRegistryRequest) => {
    return registryClient.publishToRegistry(db, request)
  })

  // Publish UI path: package a LOCALLY-AUTHORED installed plugin/skill from
  // disk in the main process (the renderer never sees file bytes) and publish.
  ipcMain.handle('registry:publishLocal', (_event, opts: PublishLocalOptions) => {
    return publishLocalItem(db, opts)
  })

  // Server-validated manifest for a version, WITHOUT downloading files — the
  // renderer's pre-install permission-consent dialog reads this.
  ipcMain.handle('registry:manifest', (_event, itemId: string, version?: string) => {
    return registryClient.getRegistryVersionManifest(db, itemId, version)
  })

  ipcMain.handle('registry:report', (_event, itemId: string, reason: string) => {
    return registryClient.reportRegistryItem(db, itemId, reason)
  })

  ipcMain.handle('registry:claimHandle', (_event, handle: string) => {
    return registryClient.claimHandle(handle)
  })

  ipcMain.handle('registry:install', async (_event, itemId: string, version?: string) => {
    const result = await registryClient.installFromRegistry(db, itemId, version)

    if (result.type === 'plugin') {
      afterPluginMutation()
      const { plugin } = result
      return {
        type: 'plugin' as const,
        id: plugin.id,
        manifest: plugin.manifest,
        dir: plugin.dir,
        enabled: plugin.enabled,
        name: plugin.manifest.name
      }
    }

    // Skills: same after-install work as the skills:install handler.
    await resetSession()
    getMainWindow(mainWindow)?.webContents.send('skills:changed')
    const { skill } = result
    return {
      type: 'skill' as const,
      id: skill.name,
      name: skill.name,
      description: skill.description,
      enabled: true,
      source: 'user',
      removable: true
    }
  })

  // Passive update check. When the renderer passes no list, derive it from the
  // on-disk `.registry.json` provenance markers (the only record of installed
  // registry versions — skills have no version field of their own).
  ipcMain.handle(
    'registry:checkUpdates',
    (_event, installed?: Pick<registryClient.RegistryInstalledRef, 'itemId' | 'version'>[]) => {
      const refs = installed ?? registryClient.listRegistryInstalls(db)
      return registryClient.checkRegistryUpdates(db, refs)
    }
  )

  // Registry provenance for installed items (renderer uses this to badge
  // community installs and gate the Publish button to locally-authored items).
  ipcMain.handle('registry:installs', () => {
    return registryClient.listRegistryInstalls(db)
  })
}
