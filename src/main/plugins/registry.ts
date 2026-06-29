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
      // Tolerate a malformed manifest: a missing/non-array `extensions` must not
      // throw and break loading of every plugin (this runs over all enabled plugins).
      const extensions = Array.isArray(artifact.extensions) ? artifact.extensions : []
      for (const ext of extensions) {
        extMap[ext.replace(/^\./, '').toLowerCase()] = kind
      }
      viewers.push({
        kind,
        pluginId: plugin.id,
        entry: artifact.entry,
        icon: artifact.icon,
        editable: artifact.editable ?? false,
        shareable: artifact.shareable ?? false,
        extensions,
        // A creatable kind needs an extension to mint a file; without one it can't
        // be created, so don't advertise it as creatable.
        creatable: (artifact.creatable ?? false) && extensions.length > 0,
        newLabel: artifact.newLabel,
        templateFile: artifact.templateFile,
        // Threaded from the trusted on-disk manifest so PluginViewer can gate the
        // gt:secret-* path; the main process re-checks server-side regardless.
        permissions: Array.isArray(plugin.manifest.permissions) ? plugin.manifest.permissions : []
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

/**
 * Resolve a single namespaced `plugin:<id>:<kind>` to its cached viewer
 * contribution, or null when no enabled plugin provides it. The returned
 * contribution comes from the trusted on-disk manifest, so the main-side share
 * authorization can read `.shareable` off it without trusting the renderer.
 */
export function getPluginViewerContribution(
  db: Database.Database,
  kind: string
): ViewerContribution | null {
  void db
  return cachedViewers.find((v) => v.kind === kind) ?? null
}
