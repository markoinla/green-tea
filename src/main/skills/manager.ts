import type Database from 'better-sqlite3'
import { app } from 'electron'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { loadSkillsFromDir, type Skill } from '@earendil-works/pi-coding-agent'
import { downloadSkillFromGitHub } from './github'
import { adaptSkillForGreenTea } from './adapt'
import { getSettingsDir } from '../agent/paths'
import {
  parseRegistryItemId,
  registryDirName,
  writeRegistryFile,
  writeRegistryProvenance
} from '../registry/install-files'

/**
 * Restore .original backup files created during adaptation.
 * If adaptation corrupted a file, this reverts it to the pre-adaptation state.
 */
function restoreOriginals(skillDir: string): void {
  if (!existsSync(skillDir)) return
  const restore = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        restore(fullPath)
      } else if (entry.name.endsWith('.original')) {
        const target = fullPath.slice(0, -'.original'.length)
        renameSync(fullPath, target)
      }
    }
  }
  restore(skillDir)
}

export function getSkillsDir(db: Database.Database): string {
  const dir = join(getSettingsDir(db), 'skills')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getDefaultSkillsDir(): string {
  // In production, resources are at process.resourcesPath/default-skills
  // In dev, they're at <project>/resources/default-skills
  const prodPath = join(process.resourcesPath, 'default-skills')
  if (existsSync(prodPath)) return prodPath
  return join(app.getAppPath(), 'resources', 'default-skills')
}

export function seedDefaultSkills(db: Database.Database): void {
  const defaultDir = getDefaultSkillsDir()
  if (!existsSync(defaultDir)) return

  const userDir = getSkillsDir(db)
  const markerPath = join(userDir, '.seeded-defaults')

  // Read already-seeded skill names
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

export function listInstalledSkills(db: Database.Database): Skill[] {
  const dir = getSkillsDir(db)
  const { skills } = loadSkillsFromDir({ dir, source: 'user' })
  return skills
}

export async function installSkillFromUrl(db: Database.Database, url: string): Promise<Skill> {
  const dir = getSkillsDir(db)

  const skillName = await downloadSkillFromGitHub(url, dir)

  // Skip adaptation for marketplace skills — they're already built for Green Tea
  const isMarketplace = url.includes('markoinla/green-tea')
  if (!isMarketplace) {
    try {
      await adaptSkillForGreenTea(db, join(dir, skillName))
    } catch {
      // Adaptation failed — restore .original files if they exist so the skill can still load
      restoreOriginals(join(dir, skillName))
    }
  }

  // Validate by loading
  let { skills } = loadSkillsFromDir({ dir, source: 'user' })
  let installed = skills.find((s) => s.name === skillName || s.baseDir.endsWith(skillName))

  // If adaptation broke the skill, restore originals and retry
  if (!installed && !isMarketplace) {
    restoreOriginals(join(dir, skillName))
    ;({ skills } = loadSkillsFromDir({ dir, source: 'user' }))
    installed = skills.find((s) => s.name === skillName || s.baseDir.endsWith(skillName))
  }

  if (!installed) {
    // Clean up on failure
    const skillDir = join(dir, skillName)
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true })
    }
    throw new Error(
      `Skill "${skillName}" was downloaded but could not be loaded. It may be missing a valid skill file.`
    )
  }

  return installed
}

/**
 * Install a skill from already-downloaded community-registry files. Unlike
 * `installSkillFromUrl` this NEVER runs the LLM adaptation step — community
 * skills are authored in/for Green Tea (mirroring the marketplace bypass) —
 * and it validates by loading with `loadSkillsFromDir`, cleaning up the dir on
 * failure, the same shape as the URL installer.
 *
 * The install dir is namespaced `<handle>--<slug>`; the skill's IDENTITY stays
 * its frontmatter `name` (publish-time validation pins slug === name), which is
 * what `skills:remove`/`disabledSkills` key on. A `.registry.json` provenance
 * marker records the registry item id + version for update checks.
 */
export function installSkillFromRegistry(
  db: Database.Database,
  opts: {
    itemId: string
    version: string
    files: { path: string; content: Buffer }[]
  }
): Skill {
  const dir = getSkillsDir(db)
  const dirName = registryDirName(opts.itemId)
  const skillDir = join(dir, dirName)

  // Install dirs are namespaced `<handle>--<slug>`, but a skill's loaded
  // IDENTITY is its frontmatter name (publish pins name === slug), and
  // `skills:remove` / `disabledSkills` key on that name — so two install dirs
  // whose SKILL.md share a name become one ambiguous skill once loaded.
  // Refuse the install (before touching disk) instead of silently shadowing.
  // Updating the SAME item is fine: its old copy lives in `skillDir` itself.
  const { slug } = parseRegistryItemId(opts.itemId)
  const { skills: existing } = loadSkillsFromDir({ dir, source: 'user' })
  const preConflict = existing.find((s) => s.name === slug && join(s.baseDir) !== skillDir)
  if (preConflict) {
    throw new Error(
      `A skill named "${slug}" is already installed (from "${preConflict.baseDir}"). ` +
        `Remove it first to install "${opts.itemId}".`
    )
  }

  // Updates overwrite in place; registry versions are immutable server-side.
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true })
  }

  try {
    mkdirSync(skillDir, { recursive: true })
    for (const file of opts.files) {
      writeRegistryFile(skillDir, file.path, file.content)
    }
    writeRegistryProvenance(skillDir, {
      itemId: opts.itemId,
      type: 'skill',
      version: opts.version,
      installedAt: new Date().toISOString()
    })

    // Validate by loading (no adaptation, no retry needed).
    const { skills } = loadSkillsFromDir({ dir, source: 'user' })
    const installed = skills.find((s) => join(s.baseDir) === skillDir)
    if (!installed) {
      throw new Error(
        `Skill "${opts.itemId}" was downloaded but could not be loaded. It may be missing a valid SKILL.md.`
      )
    }
    // Defense in depth for the collision guard above: the pre-check assumes
    // frontmatter name === slug (a server-side publish invariant). If a bundle
    // slips through with a different name, catch the collision on the LOADED
    // name too and roll back.
    const postConflict = skills.find(
      (s) => s.name === installed.name && join(s.baseDir) !== skillDir
    )
    if (postConflict) {
      throw new Error(
        `A skill named "${installed.name}" is already installed (from "${postConflict.baseDir}"). ` +
          `Remove it first to install "${opts.itemId}".`
      )
    }
    return installed
  } catch (err) {
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true })
    }
    throw err
  }
}

export function removeSkill(db: Database.Database, name: string): void {
  const dir = getSkillsDir(db)
  const skills = listInstalledSkills(db)
  const skill = skills.find((s) => s.name === name)

  if (!skill) {
    throw new Error(`Skill "${name}" not found`)
  }

  // Validate the baseDir is under our skills directory
  const resolved = join(skill.baseDir)
  if (!resolved.startsWith(dir)) {
    throw new Error('Cannot remove skill outside of managed directory')
  }

  rmSync(skill.baseDir, { recursive: true })
}
