/**
 * Plugin-bundled skills. A plugin may ship one or more agent skills alongside its
 * viewer via `contributes.skills` (plugin-dir-relative directory paths). They are
 * loaded IN PLACE from the plugin directory — never copied into the user skills dir
 * and never run through the `adaptSkillForGreenTea` rewrite — so their lifecycle is
 * tied to the plugin's enabled state and uninstalling the plugin removes them.
 *
 * Trust: a bundled skill carries the SAME trust as a standalone skill (instructions
 * + the agent's already-sandboxed bash/read/edit tools). It is NOT an in-process
 * agent tool; nothing here lets a plugin register a model-callable tool.
 */
import type Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'
import { loadSkillsFromDir, type Skill } from '@earendil-works/pi-coding-agent'
import { listInstalledPlugins } from './manager'

/** A skill loaded from a plugin, tagged with the plugin that contributed it. */
export interface PluginSkill {
  skill: Skill
  pluginId: string
}

/** The `Skill.sourceInfo.source` tag for a skill contributed by plugin `<id>`. */
export function pluginSkillSource(pluginId: string): string {
  return `plugin:${pluginId}`
}

/**
 * The stable identity used to track a plugin skill's disabled state (and in the UI),
 * namespaced by plugin id so it can never collide with a same-named user skill in the
 * flat `disabledSkills` list.
 */
export function pluginSkillId(pluginId: string, skillName: string): string {
  return `plugin:${pluginId}:${skillName}`
}

/**
 * Resolve `rel` against `pluginDir` and return the absolute path only if it stays
 * inside `pluginDir`; otherwise null. Guards against `..`/symlink-style escapes even
 * though `loadManifest` already rejects obvious traversal — the loader never trusts
 * that the on-disk manifest was validated by this exact build.
 */
function clampToPluginDir(pluginDir: string, rel: string): string | null {
  if (typeof rel !== 'string' || rel.length === 0 || isAbsolute(rel)) return null
  const abs = resolve(pluginDir, rel)
  const within = relative(pluginDir, abs)
  if (within === '' || within.startsWith('..') || isAbsolute(within)) return null
  return abs
}

/**
 * Load all skills bundled by ENABLED plugins, each tagged with its plugin id. Disabled
 * plugins contribute nothing. Missing/escaping/empty skill directories are skipped
 * silently — a malformed `contributes.skills` must never break skill loading for the
 * rest of the app.
 */
export function loadPluginSkills(db: Database.Database): PluginSkill[] {
  const plugins = listInstalledPlugins(db).filter((p) => p.enabled)
  const out: PluginSkill[] = []

  for (const plugin of plugins) {
    const declared = plugin.manifest.contributes?.skills
    if (!Array.isArray(declared)) continue

    for (const rel of declared) {
      const dir = clampToPluginDir(plugin.dir, rel)
      if (!dir || !existsSync(dir)) continue
      try {
        const { skills } = loadSkillsFromDir({ dir, source: pluginSkillSource(plugin.id) })
        for (const skill of skills) {
          // Belt-and-suspenders: a loaded skill's baseDir must live under the plugin dir.
          const within = relative(plugin.dir, skill.baseDir)
          if (within.startsWith('..') || isAbsolute(within)) continue
          out.push({ skill, pluginId: plugin.id })
        }
      } catch {
        // Skip a plugin's bad skill dir rather than failing the whole load.
        continue
      }
    }
  }

  return out
}
