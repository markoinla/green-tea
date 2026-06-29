import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    // A deliberately low app version so a high minAppVersion fails the gate.
    getVersion: () => '6.2.1',
    getAppPath: () => process.cwd()
  }
}))

import type Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { getPluginsDir, listInstalledPlugins } from './manager'
import type { PluginManifest } from './types'

let db: Database.Database
let baseDir: string

function writePlugin(dirName: string, manifest: unknown): void {
  const pluginDir = join(getPluginsDir(db), dirName)
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify(manifest))
}

const goodManifest: PluginManifest = {
  id: 'mermaid',
  name: 'Mermaid',
  version: '1.0.0',
  description: 'Render mermaid diagrams',
  contributes: {
    artifacts: [{ kind: 'mermaid', extensions: ['mmd'], entry: 'viewer.html', icon: 'GitBranch' }]
  }
}

beforeEach(() => {
  db = createTestDb()
  baseDir = mkdtempSync(join(tmpdir(), 'gt-plugin-mgr-'))
  setSetting(db, 'agentBaseDir', baseDir)
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe('getPluginsDir', () => {
  it('returns <agentBaseDir>/plugins and creates it', () => {
    const dir = getPluginsDir(db)
    expect(dir).toBe(join(baseDir, 'plugins'))
    expect(existsSync(dir)).toBe(true)
  })
})

describe('manifest validation (via listInstalledPlugins)', () => {
  it('accepts a well-formed manifest', () => {
    writePlugin('mermaid', goodManifest)
    const plugins = listInstalledPlugins(db)
    expect(plugins.map((p) => p.id)).toContain('mermaid')
    const found = plugins.find((p) => p.id === 'mermaid')!
    expect(found.manifest.name).toBe('Mermaid')
    expect(found.enabled).toBe(true)
  })

  it('rejects a manifest with an illegal id (contains "plugin:")', () => {
    writePlugin('bad-id', { ...goodManifest, id: 'plugin:evil' })
    expect(listInstalledPlugins(db).some((p) => p.dir.endsWith('bad-id'))).toBe(false)
  })

  it('rejects a manifest with whitespace in the id', () => {
    writePlugin('space-id', { ...goodManifest, id: 'has space' })
    expect(listInstalledPlugins(db).some((p) => p.dir.endsWith('space-id'))).toBe(false)
  })

  it('rejects a manifest missing required fields', () => {
    writePlugin('no-name', { id: 'x', version: '1.0.0', description: 'd' })
    expect(listInstalledPlugins(db).some((p) => p.dir.endsWith('no-name'))).toBe(false)
  })

  it('rejects a manifest with a too-high minAppVersion', () => {
    writePlugin('future', { ...goodManifest, id: 'future', minAppVersion: '99.0.0' })
    expect(listInstalledPlugins(db).some((p) => p.id === 'future')).toBe(false)
  })

  it('accepts a manifest whose minAppVersion the app satisfies', () => {
    writePlugin('ok-min', { ...goodManifest, id: 'okmin', minAppVersion: '1.0.0' })
    expect(listInstalledPlugins(db).some((p) => p.id === 'okmin')).toBe(true)
  })
})

describe('enabled flag honors disabledPlugins setting', () => {
  it('marks a plugin disabled when its id is in disabledPlugins', () => {
    writePlugin('mermaid', goodManifest)
    setSetting(db, 'disabledPlugins', JSON.stringify(['mermaid']))
    const found = listInstalledPlugins(db).find((p) => p.id === 'mermaid')!
    expect(found.enabled).toBe(false)
  })
})
