import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getVersion: () => '6.2.1',
    getAppPath: () => process.cwd()
  }
}))

import type Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { getPluginsDir, listInstalledPlugins } from './manager'
import { loadPluginSkills, pluginSkillSource, pluginSkillId } from './skills'

let db: Database.Database
let baseDir: string

/** Write a plugin dir with a manifest and any number of bundled skills. */
function writePluginWithSkills(
  id: string,
  contributesSkills: string[] | undefined,
  skills: { relDir: string; name: string; description: string }[]
): void {
  const pluginDir = join(getPluginsDir(db), id)
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(
    join(pluginDir, 'manifest.json'),
    JSON.stringify({
      id,
      name: id,
      version: '1.0.0',
      description: `${id} plugin`,
      contributes: { skills: contributesSkills }
    })
  )
  for (const s of skills) {
    const dir = join(pluginDir, s.relDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\nDo the thing.\n`
    )
  }
}

beforeEach(() => {
  db = createTestDb()
  baseDir = mkdtempSync(join(tmpdir(), 'gt-plugin-skills-'))
  setSetting(db, 'agentBaseDir', baseDir)
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe('loadPluginSkills', () => {
  it('loads a bundled skill from an enabled plugin, tagged with the plugin source', () => {
    writePluginWithSkills(
      'kanban-board',
      ['skills'],
      [
        {
          relDir: join('skills', 'kanban-edit'),
          name: 'kanban-edit',
          description: 'Edit kanban files'
        }
      ]
    )

    const loaded = loadPluginSkills(db)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].pluginId).toBe('kanban-board')
    expect(loaded[0].skill.name).toBe('kanban-edit')
    expect(loaded[0].skill.sourceInfo.source).toBe(pluginSkillSource('kanban-board'))
  })

  it('contributes nothing from a disabled plugin', () => {
    writePluginWithSkills(
      'kanban-board',
      ['skills'],
      [
        {
          relDir: join('skills', 'kanban-edit'),
          name: 'kanban-edit',
          description: 'Edit kanban files'
        }
      ]
    )
    setSetting(db, 'disabledPlugins', JSON.stringify(['kanban-board']))

    expect(loadPluginSkills(db)).toHaveLength(0)
  })

  it('skips a declared skill dir that does not exist', () => {
    writePluginWithSkills('ghost', ['skills'], []) // declares skills/ but writes none
    expect(loadPluginSkills(db)).toHaveLength(0)
  })

  it('loads nothing when the plugin declares no skills', () => {
    writePluginWithSkills('plain', undefined, [])
    expect(loadPluginSkills(db)).toHaveLength(0)
  })

  it('namespaces the disabled-tracking id by plugin', () => {
    expect(pluginSkillId('kanban-board', 'kanban-edit')).toBe('plugin:kanban-board:kanban-edit')
  })
})

describe('manifest validation of contributes.skills (via listInstalledPlugins)', () => {
  function writeRawManifest(id: string, contributes: unknown): void {
    const pluginDir = join(getPluginsDir(db), id)
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(
      join(pluginDir, 'manifest.json'),
      JSON.stringify({ id, name: id, version: '1.0.0', description: 'x', contributes })
    )
  }

  it('rejects a traversal path in contributes.skills', () => {
    writeRawManifest('escape', { skills: ['../../etc'] })
    expect(listInstalledPlugins(db).some((p) => p.id === 'escape')).toBe(false)
  })

  it('rejects an absolute path in contributes.skills', () => {
    writeRawManifest('abs', { skills: ['/etc/passwd'] })
    expect(listInstalledPlugins(db).some((p) => p.id === 'abs')).toBe(false)
  })

  it('rejects a non-array contributes.skills', () => {
    writeRawManifest('notarr', { skills: 'skills' })
    expect(listInstalledPlugins(db).some((p) => p.id === 'notarr')).toBe(false)
  })

  it('accepts a well-formed relative contributes.skills', () => {
    writeRawManifest('ok', { skills: ['skills', 'extra/skill-two'] })
    expect(listInstalledPlugins(db).some((p) => p.id === 'ok')).toBe(true)
  })
})
