/**
 * Shared plugin-system types. A plugin is a directory under the plugins dir with
 * a `manifest.json`; it may contribute artifact viewers (a `kind` + the file
 * extensions that map to it + a viewer entry served over `gt-plugin://`).
 */

/** A single artifact-viewer contribution declared in a plugin manifest. */
export interface ArtifactContribution {
  kind: string
  extensions: string[]
  entry: string
  icon: string
  editable?: boolean
  /**
   * Opt this artifact kind into public sharing. When true, a published, FROZEN,
   * read-only HTML snapshot of the artifact may be created via the user-driven
   * share flow. Defaults to false — a plugin must explicitly opt in. The main
   * process re-checks this from the trusted on-disk manifest before publishing,
   * so the renderer's UI gating alone is never trusted.
   */
  shareable?: boolean
}

/** The parsed `manifest.json` of an installed plugin. */
export interface PluginManifest {
  id: string
  name: string
  version: string
  minAppVersion?: string
  description: string
  author?: string
  authorUrl?: string
  contributes?: {
    artifacts?: ArtifactContribution[]
  }
}

/** An installed plugin: its manifest, on-disk directory, and enabled state. */
export interface InstalledPlugin {
  id: string
  manifest: PluginManifest
  dir: string
  enabled: boolean
}

/** The namespaced derived kind for a plugin artifact, e.g. `plugin:mermaid:mermaid`. */
export function pluginKind(pluginId: string, kind: string): string {
  return `plugin:${pluginId}:${kind}`
}

/**
 * A flat viewer contribution the renderer consumes — one per artifact kind across
 * all enabled plugins. The `entry` is a `gt-plugin://`-relative path.
 */
export interface ViewerContribution {
  kind: string
  pluginId: string
  entry: string
  icon: string
  editable: boolean
  /** Whether this kind may be published as a read-only share (manifest opt-in). */
  shareable: boolean
}
