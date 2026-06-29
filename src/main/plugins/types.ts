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
  /**
   * Opt this artifact kind into being user-creatable. When true, the app shows a
   * "New <label>" item in the root "+" and folder right-click menus that creates a
   * fresh file of this kind. Defaults to false — a plugin must explicitly opt in.
   */
  creatable?: boolean
  /** Menu label for the "New <kind>" item; when absent the renderer derives one. */
  newLabel?: string
  /**
   * Filename, relative to the plugin directory, whose bytes seed each newly created
   * artifact. When absent, new artifacts are seeded with an empty string. The main
   * process clamps this read to the plugin dir and falls back to '' if unreadable.
   */
  templateFile?: string
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
  /**
   * Opt-in capabilities the plugin requests (the first brick of a plugin
   * permission model, §4.9.1). Currently the only honored value is `"secrets"`,
   * which gates the mediated `gt:secret-*` postMessage path; the main process
   * re-checks this from the trusted on-disk manifest before serving any secret.
   */
  permissions?: string[]
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
  /** The file extensions that map to this kind (dot-optional, as authored). */
  extensions: string[]
  /** Whether the user may create a new artifact of this kind (manifest opt-in). */
  creatable: boolean
  /** Menu label for the "New <kind>" item; when absent the renderer derives one. */
  newLabel?: string
  /** Plugin-dir-relative filename whose bytes seed each newly created artifact. */
  templateFile?: string
  /**
   * The plugin's declared `permissions` (from its trusted on-disk manifest),
   * threaded to the renderer so `PluginViewer` can gate the `gt:secret-*` path
   * client-side too. The main process re-checks server-side regardless.
   */
  permissions: string[]
}
