import type Database from 'better-sqlite3'
import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { InstalledPlugin, PluginManifest } from './types'
import { downloadFromGitHub } from '../util/github-download'
import { getAgentBaseDir } from '../agent/paths'
import { getSetting } from '../database/repositories/settings'

export function getPluginsDir(db: Database.Database): string {
  const dir = join(getAgentBaseDir(db), 'plugins')
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
  if (manifest.id.includes('plugin:') || /\s/.test(manifest.id)) {
    throw new Error(`Plugin id "${manifest.id}" is invalid (no whitespace or "plugin:" allowed)`)
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
