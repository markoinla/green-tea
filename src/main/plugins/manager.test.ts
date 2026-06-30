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
  it('returns <agentBaseDir>/.settings/plugins and creates it', () => {
    const dir = getPluginsDir(db)
    expect(dir).toBe(join(baseDir, '.settings', 'plugins'))
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
    writePlugin('okmin', { ...goodManifest, id: 'okmin', minAppVersion: '1.0.0' })
    expect(listInstalledPlugins(db).some((p) => p.id === 'okmin')).toBe(true)
  })

  it('rejects an id that does not match its install-dir name', () => {
    // Valid charset, but the directory is named differently — this closes the
    // "a dir hosts a plugin claiming a different (trusted) id" vector.
    writePlugin('actual-dir', { ...goodManifest, id: 'claimed-id' })
    expect(listInstalledPlugins(db).some((p) => p.dir.endsWith('actual-dir'))).toBe(false)
  })

  it('rejects an id with uppercase or illegal delimiter characters', () => {
    writePlugin('UpperCase', { ...goodManifest, id: 'UpperCase' })
    writePlugin('with:colon', { ...goodManifest, id: 'with:colon' })
    writePlugin('with_underscore', { ...goodManifest, id: 'with_underscore' })
    const ids = listInstalledPlugins(db).map((p) => p.id)
    expect(ids).not.toContain('UpperCase')
    expect(ids).not.toContain('with:colon')
    expect(ids).not.toContain('with_underscore')
  })

  it('accepts a valid "secrets" permission and threads it through', () => {
    writePlugin('secretful', { ...goodManifest, id: 'secretful', permissions: ['secrets'] })
    const found = listInstalledPlugins(db).find((p) => p.id === 'secretful')
    expect(found?.manifest.permissions).toEqual(['secrets'])
  })

  it('rejects a manifest with a non-array / malformed permissions field', () => {
    writePlugin('badperm', { ...goodManifest, id: 'badperm', permissions: 'secrets' })
    writePlugin('badperm2', { ...goodManifest, id: 'badperm2', permissions: [123] })
    const ids = listInstalledPlugins(db).map((p) => p.id)
    expect(ids).not.toContain('badperm')
    expect(ids).not.toContain('badperm2')
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
