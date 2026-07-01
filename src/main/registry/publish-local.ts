import { readFileSync, readdirSync } from 'fs'
import { join, relative, sep } from 'path'
import type Database from 'better-sqlite3'
import type {
  PublishRegistryResponse,
  RegistryItemType,
  RegistryPackageFile
} from '../../shared/share-contract'
import { listInstalledPlugins } from '../plugins/manager'
import { getSkillsDir, listInstalledSkills } from '../skills/manager'
import { publishToRegistry } from './client'
import {
  REGISTRY_MARKER_FILENAME,
  SLUG_REGEX,
  VERSION_REGEX,
  readRegistryProvenance,
  validateRegistryFilePath
} from './install-files'

/**
 * Packaging + publishing of LOCALLY-AUTHORED items (Publish UI, Phase 4).
 *
 * The renderer never sees file bytes: it identifies the item by its local id
 * (plugin id / skill name) plus a version and optional first-publish handle,
 * and the main process reads the installed directory, base64-encodes each file
 * and hands the package to `publishToRegistry`. Registry-sourced installs
 * (anything carrying a `.registry.json` provenance marker) are refused here —
 * only locally-authored items are publishable. Publishing is a manual UI
 * action only; none of this is reachable as an agent tool.
 */

/** Mirrors the worker's decoded-package cap (§6, 10 MB default). */
const MAX_PACKAGE_BYTES = 10 * 1024 * 1024

/**
 * Skill names are STRICTER than plugin slugs (the loader's name rules): no
 * leading/trailing hyphen and no consecutive hyphens (`--` is the handle/slug
 * separator in derived install-dir names).
 */
const SKILL_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Directory names never descended into when packaging. */
const EXCLUDED_DIRS = new Set(['.git', 'node_modules'])

/** File names never included in a package. */
const EXCLUDED_FILES = new Set([REGISTRY_MARKER_FILENAME, '.DS_Store'])

/**
 * Recursively read every file under `rootDir` into the publish file shape.
 * Paths are validated with the same hostile-path validator the install side
 * uses, and the summed decoded size is capped to fail fast before upload.
 */
function collectPackageFiles(
  rootDir: string,
  excludeRootFiles: ReadonlySet<string> = new Set()
): RegistryPackageFile[] {
  const files: RegistryPackageFile[] = []
  let totalBytes = 0

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      if (EXCLUDED_FILES.has(entry.name)) continue
      const relPath = relative(rootDir, fullPath).split(sep).join('/')
      if (excludeRootFiles.has(relPath)) continue
      validateRegistryFilePath(relPath)
      const content = readFileSync(fullPath)
      totalBytes += content.length
      if (totalBytes > MAX_PACKAGE_BYTES) {
        throw new Error(
          `Package is too large (over ${Math.floor(MAX_PACKAGE_BYTES / (1024 * 1024))} MB)`
        )
      }
      files.push({ path: relPath, contentBase64: content.toString('base64') })
    }
  }

  walk(rootDir)
  if (files.length === 0) {
    throw new Error('Nothing to publish — the item directory is empty')
  }
  return files
}

export interface PublishLocalOptions {
  type: RegistryItemType
  /** Plugin id, or skill name — the same local identity the manage UI shows. */
  localId: string
  /** Strict release semver for the new version. */
  version: string
  /** Publisher handle — only on the user's first-ever publish. */
  handle?: string
}

/**
 * Package a locally-authored plugin or skill from disk and publish it.
 * Plugins: slug = manifest id, the manifest is sent separately (never as a
 * bundle file) with its `version` synced to the published version. Skills:
 * slug = the SKILL.md frontmatter name (the worker pins slug === name).
 */
export async function publishLocalItem(
  db: Database.Database,
  opts: PublishLocalOptions
): Promise<PublishRegistryResponse> {
  if (!VERSION_REGEX.test(opts.version)) {
    throw new Error(`Invalid version "${opts.version}" (expected release semver, e.g. "1.2.0")`)
  }

  if (opts.type === 'plugin') {
    const plugin = listInstalledPlugins(db).find((p) => p.id === opts.localId)
    if (!plugin) {
      throw new Error(`Plugin "${opts.localId}" not found`)
    }
    if (readRegistryProvenance(plugin.dir)) {
      throw new Error(
        `Plugin "${opts.localId}" was installed from the community registry — only locally-authored plugins can be published`
      )
    }
    // manifest.json is served separately by the worker (and rejected as a
    // bundle file at install time), so exclude it from the file list.
    const files = collectPackageFiles(plugin.dir, new Set(['manifest.json']))
    const manifest = { ...plugin.manifest, version: opts.version } as Record<string, unknown>
    return publishToRegistry(db, {
      type: 'plugin',
      slug: plugin.id,
      handle: opts.handle,
      version: opts.version,
      manifest,
      files
    })
  }

  const skill = listInstalledSkills(db).find((s) => s.name === opts.localId)
  if (!skill) {
    throw new Error(`Skill "${opts.localId}" not found`)
  }
  const skillsDir = getSkillsDir(db)
  const skillDir = join(skill.baseDir)
  if (!skillDir.startsWith(skillsDir)) {
    throw new Error('Only user-installed skills can be published')
  }
  if (readRegistryProvenance(skillDir)) {
    throw new Error(
      `Skill "${opts.localId}" was installed from the community registry — only locally-authored skills can be published`
    )
  }
  if (!SLUG_REGEX.test(skill.name) || !SKILL_SLUG_REGEX.test(skill.name)) {
    throw new Error(
      `Skill name "${skill.name}" cannot be used as a registry slug (lowercase letters, digits and single hyphens only)`
    )
  }
  const files = collectPackageFiles(skillDir)
  const manifest: Record<string, unknown> = {
    name: skill.name,
    description: skill.description
  }
  return publishToRegistry(db, {
    type: 'skill',
    slug: skill.name,
    handle: opts.handle,
    version: opts.version,
    manifest,
    files
  })
}
