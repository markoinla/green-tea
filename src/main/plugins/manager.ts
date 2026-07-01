import type Database from 'better-sqlite3'
import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { basename, isAbsolute, join } from 'path'
import type { InstalledPlugin, PluginManifest } from './types'
import { downloadFromGitHub } from '../util/github-download'
import { getSettingsDir } from '../agent/paths'
import { getSetting } from '../database/repositories/settings'
import {
  registryDirName,
  writeRegistryFile,
  writeRegistryProvenance
} from '../registry/install-files'

export function getPluginsDir(db: Database.Database): string {
  const dir = join(getSettingsDir(db), 'plugins')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getDefaultPluginsDir(): string {
  // In production, resources are at process.resourcesPath/default-plugins
  // In dev, they're at <project>/resources/default-plugins
  const prodPath = join(process.resourcesPath, 'default-plugins')
  if (existsSync(prodPath)) return prodPath
  return join(app.getAppPath(), 'resources', 'default-plugins')
}

/**
 * Compare two dotted version strings. Returns true when `version` is >= `min`.
 * Missing/non-numeric segments are treated as 0.
 */
function satisfiesMinVersion(version: string, min: string): boolean {
  const a = version.split('.').map((p) => parseInt(p, 10) || 0)
  const b = min.split('.').map((p) => parseInt(p, 10) || 0)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return true
}

/**
 * Read, parse and validate a plugin's `manifest.json`. Throws on any structural
 * problem (missing required fields, illegal id, unsatisfied minAppVersion).
 */
function loadManifest(dir: string): PluginManifest {
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`Plugin at "${dir}" is missing manifest.json`)
  }

  let manifest: PluginManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch {
    throw new Error(`Plugin at "${dir}" has an invalid manifest.json`)
  }

  if (!manifest.id || typeof manifest.id !== 'string') {
    throw new Error('Plugin manifest is missing a valid "id"')
  }
  // Strict, delimiter-free charset. This is the SOURCE of the `plugin:<id>:<subKey>`
  // secret-key grammar (§4.9.1): forbidding `:`, `%`, `_`, whitespace and uppercase
  // here closes the key-collision / enumeration vectors before `id` is ever used to
  // build a storage key. Must run BEFORE any pluginId-derived key is constructed.
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.id)) {
    throw new Error(
      `Plugin id "${manifest.id}" is invalid (must match /^[a-z0-9][a-z0-9-]{0,63}$/)`
    )
  }
  // The id must equal the install-dir name, so a directory can never host a plugin
  // claiming a different (e.g. already-trusted) id, and removal/lookup by id is sound.
  const dirName = basename(dir)
  if (manifest.id !== dirName) {
    throw new Error(`Plugin id "${manifest.id}" must equal its install directory name "${dirName}"`)
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error(`Plugin "${manifest.id}" is missing a valid "name"`)
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error(`Plugin "${manifest.id}" is missing a valid "version"`)
  }
  if (!manifest.description || typeof manifest.description !== 'string') {
    throw new Error(`Plugin "${manifest.id}" is missing a valid "description"`)
  }
  if (manifest.permissions !== undefined) {
    if (
      !Array.isArray(manifest.permissions) ||
      manifest.permissions.some((p) => typeof p !== 'string' || p.length === 0 || p.length > 64)
    ) {
      throw new Error(
        `Plugin "${manifest.id}" has an invalid "permissions" (must be an array of non-empty strings)`
      )
    }
  }

  // `contributes.skills` is a list of plugin-dir-relative skill directories. Validate
  // shape here and reject any path that could escape the plugin dir BEFORE it is ever
  // resolved against the filesystem (the loader re-clamps too — defense in depth).
  const skillPaths = manifest.contributes?.skills
  if (skillPaths !== undefined) {
    if (
      !Array.isArray(skillPaths) ||
      skillPaths.some(
        (p) =>
          typeof p !== 'string' ||
          p.length === 0 ||
          p.length > 256 ||
          isAbsolute(p) ||
          p.split(/[/\\]/).includes('..')
      )
    ) {
      throw new Error(
        `Plugin "${manifest.id}" has an invalid "contributes.skills" (must be relative paths inside the plugin)`
      )
    }
  }

  if (manifest.minAppVersion) {
    const appVersion = app.getVersion()
    if (!satisfiesMinVersion(appVersion, manifest.minAppVersion)) {
      throw new Error(
        `Plugin "${manifest.id}" requires app version ${manifest.minAppVersion} (current: ${appVersion})`
      )
    }
  }

  return manifest
}

export function seedDefaultPlugins(db: Database.Database): void {
  const defaultDir = getDefaultPluginsDir()
  if (!existsSync(defaultDir)) return

  const userDir = getPluginsDir(db)
  const markerPath = join(userDir, '.seeded-defaults')

  // Read already-seeded plugin names
  let seeded: string[] = []
  if (existsSync(markerPath)) {
    try {
      seeded = JSON.parse(readFileSync(markerPath, 'utf-8'))
    } catch {
      seeded = []
    }
  }

  const entries = readdirSync(defaultDir, { withFileTypes: true })
  let changed = false

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    const targetDir = join(userDir, name)

    // Re-seed if the directory was deleted, even if previously seeded
    if (seeded.includes(name) && existsSync(targetDir)) continue

    if (!existsSync(targetDir)) {
      cpSync(join(defaultDir, name), targetDir, { recursive: true })
    }

    if (!seeded.includes(name)) seeded.push(name)
    changed = true
  }

  if (changed) {
    writeFileSync(markerPath, JSON.stringify(seeded))
  }
}

function getDisabledPlugins(db: Database.Database): string[] {
  const raw = getSetting(db, 'disabledPlugins')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function listInstalledPlugins(db: Database.Database): InstalledPlugin[] {
  const dir = getPluginsDir(db)
  const disabled = getDisabledPlugins(db)
  const plugins: InstalledPlugin[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pluginDir = join(dir, entry.name)
    let manifest: PluginManifest
    try {
      manifest = loadManifest(pluginDir)
    } catch {
      // Skip directories that aren't valid plugins (bad/missing manifest, etc.)
      continue
    }
    plugins.push({
      id: manifest.id,
      manifest,
      dir: pluginDir,
      enabled: !disabled.includes(manifest.id)
    })
  }

  return plugins
}

export async function installPluginFromUrl(
  db: Database.Database,
  url: string
): Promise<InstalledPlugin> {
  const dir = getPluginsDir(db)

  // Plugins are code — no LLM adaptation step. Download verbatim.
  const pluginName = await downloadFromGitHub(url, dir)
  const pluginDir = join(dir, pluginName)

  let manifest: PluginManifest
  try {
    manifest = loadManifest(pluginDir)
  } catch (err) {
    // Clean up on validation failure
    if (existsSync(pluginDir)) {
      rmSync(pluginDir, { recursive: true })
    }
    throw err
  }

  const disabled = getDisabledPlugins(db)
  return {
    id: manifest.id,
    manifest,
    dir: pluginDir,
    enabled: !disabled.includes(manifest.id)
  }
}

/**
 * Install a plugin from already-downloaded community-registry files. Lives here
 * (not in registry/client.ts) so it can call the module-private `loadManifest`
 * for the same validate-then-write shape as `installPluginFromUrl`.
 *
 * Registry installs are namespaced on disk as `<handle>--<slug>` (slugs are
 * only unique per handle), and `loadManifest` requires id === dirname, so the
 * server-validated manifest's `id` is rewritten to that derived name. The
 * manifest is ALWAYS the server-validated one passed in `manifest` — a bundle
 * file named `manifest.json` is rejected (it could shadow the validated copy).
 * A `.registry.json` provenance marker records the registry item id + version
 * for update checks, consent gating, and publish-button gating.
 */
export function installPluginFromRegistry(
  db: Database.Database,
  opts: {
    itemId: string
    version: string
    manifest: Record<string, unknown>
    files: { path: string; content: Buffer }[]
  }
): InstalledPlugin {
  const dirName = registryDirName(opts.itemId)
  const pluginDir = join(getPluginsDir(db), dirName)

  // Updates overwrite in place; versions are immutable server-side, so the
  // incoming files fully define the new state.
  if (existsSync(pluginDir)) {
    rmSync(pluginDir, { recursive: true })
  }

  try {
    mkdirSync(pluginDir, { recursive: true })
    for (const file of opts.files) {
      if (file.path === 'manifest.json') {
        throw new Error(
          'Registry package illegally contains manifest.json (the validated manifest is served separately)'
        )
      }
      writeRegistryFile(pluginDir, file.path, file.content)
    }
    writeFileSync(
      join(pluginDir, 'manifest.json'),
      JSON.stringify({ ...opts.manifest, id: dirName }, null, 2)
    )
    writeRegistryProvenance(pluginDir, {
      itemId: opts.itemId,
      type: 'plugin',
      version: opts.version,
      installedAt: new Date().toISOString()
    })

    const manifest = loadManifest(pluginDir)
    const disabled = getDisabledPlugins(db)
    return {
      id: manifest.id,
      manifest,
      dir: pluginDir,
      enabled: !disabled.includes(manifest.id)
    }
  } catch (err) {
    // Clean up on any validation/write failure — never leave a half-written plugin.
    if (existsSync(pluginDir)) {
      rmSync(pluginDir, { recursive: true })
    }
    throw err
  }
}

export function removePlugin(db: Database.Database, id: string): void {
  const dir = getPluginsDir(db)
  const plugin = listInstalledPlugins(db).find((p) => p.id === id)

  if (!plugin) {
    throw new Error(`Plugin "${id}" not found`)
  }

  // Validate the dir is under our plugins directory
  if (!plugin.dir.startsWith(dir)) {
    throw new Error('Cannot remove plugin outside of managed directory')
  }

  rmSync(plugin.dir, { recursive: true })
}
