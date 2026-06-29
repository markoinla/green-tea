import type Database from 'better-sqlite3'
import type { ViewerContribution } from './types'
import { pluginKind } from './types'
import { listInstalledPlugins } from './manager'
import { setPluginExtMap } from '../vault/artifact-kinds'

/**
 * Cached, flattened viewer contributions across all enabled plugins. Rebuilt by
 * `reloadPluginRegistry` whenever installed/enabled plugins change.
 */
let cachedViewers: ViewerContribution[] = []

/**
 * Read the enabled plugins, (re)build the extension → namespaced-kind map (pushed
 * to the artifact-kinds module via `setPluginExtMap`), and cache the flat list of
 * viewer contributions. Call this at startup and after any plugin mutation.
 */
export function reloadPluginRegistry(db: Database.Database): void {
  const plugins = listInstalledPlugins(db).filter((p) => p.enabled)

  const extMap: Record<string, string> = {}
  const viewers: ViewerContribution[] = []

  for (const plugin of plugins) {
    const artifacts = plugin.manifest.contributes?.artifacts ?? []
    for (const artifact of artifacts) {
      const kind = pluginKind(plugin.id, artifact.kind)
      for (const ext of artifact.extensions) {
        extMap[ext.replace(/^\./, '').toLowerCase()] = kind
      }
      viewers.push({
        kind,
        pluginId: plugin.id,
        entry: artifact.entry,
        icon: artifact.icon,
        editable: artifact.editable ?? false
      })
    }
  }

  setPluginExtMap(extMap)
  cachedViewers = viewers
}

/**
 * The cached flat viewer contributions for all enabled plugins. The `db` param is
 * kept for API symmetry/future use even though the cache is module-level.
 */
export function getPluginViewerContributions(db: Database.Database): ViewerContribution[] {
  void db
  return cachedViewers
}
