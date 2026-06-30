import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import {
  getVaultsRoot,
  getWorkspaceVaultDir,
  migrateGlobalConfigToSettings,
  migrateLegacyVaultLayout
} from './paths'
import { getSettingsDir, getWorkspaceDir } from '../agent/paths'
import { createWorkspace } from '../database/repositories/workspaces'

let db: Database.Database
let base: string
let legacyHome: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-paths-'))
  // Separate temp dir standing in for the real homedir `mcp.json` source, so the
  // migration tests never touch a real `~/Documents/Green Tea`.
  legacyHome = mkdtempSync(join(tmpdir(), 'gt-home-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
  rmSync(legacyHome, { recursive: true, force: true })
})

/** Seed a legacy `vaults/<name>/<file>` with contents. */
function seedLegacyNote(name: string, file: string, body: string): void {
  const dir = join(base, 'vaults', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), body, 'utf-8')
}

describe('layout', () => {
  it('the notes vault is the same folder the agent works under', () => {
    const id = createWorkspace(db, { name: 'My Workspace' }).id
    // Notes live at the workspace root; the agent home is a subfolder of it.
    expect(getWorkspaceVaultDir(db, id)).toBe(getWorkspaceDir(db, id))
    expect(getVaultsRoot(db)).toBe(join(base, 'workspaces'))
  })
})

describe('migrateLegacyVaultLayout', () => {
  it('renames the whole vaults/ tree to workspaces/ when none exists yet', () => {
    seedLegacyNote('My Workspace', 'Note.md', '# hi')
    migrateLegacyVaultLayout(db)

    expect(existsSync(join(base, 'vaults'))).toBe(false)
    expect(readFileSync(join(base, 'workspaces', 'My Workspace', 'Note.md'), 'utf-8')).toBe('# hi')
  })

  it('renames non-colliding workspaces and merges colliding ones file-by-file', () => {
    seedLegacyNote('A', 'a.md', 'legacy-a') // collides with target
    seedLegacyNote('A', 'legacy-only.md', 'legacy-only') // legacy-only: must survive
    seedLegacyNote('B', 'b.md', 'legacy-b') // no collision: whole folder moves
    // A already migrated (target present) — existing files must NOT be overwritten.
    const existingA = join(base, 'workspaces', 'A')
    mkdirSync(existingA, { recursive: true })
    writeFileSync(join(existingA, 'a.md'), 'current-a', 'utf-8')

    migrateLegacyVaultLayout(db)

    // Existing target file preserved; legacy-only file merged in (no data loss).
    expect(readFileSync(join(base, 'workspaces', 'A', 'a.md'), 'utf-8')).toBe('current-a')
    expect(readFileSync(join(base, 'workspaces', 'A', 'legacy-only.md'), 'utf-8')).toBe('legacy-only')
    expect(readFileSync(join(base, 'workspaces', 'B', 'b.md'), 'utf-8')).toBe('legacy-b')
    // The colliding file stayed behind (not overwritten); the merged one moved out.
    expect(existsSync(join(base, 'vaults', 'A', 'a.md'))).toBe(true)
    expect(existsSync(join(base, 'vaults', 'A', 'legacy-only.md'))).toBe(false)
    expect(existsSync(join(base, 'vaults', 'B'))).toBe(false)
  })

  it('is a no-op when there is no legacy vaults/ folder', () => {
    expect(() => migrateLegacyVaultLayout(db)).not.toThrow()
    expect(existsSync(join(base, 'vaults'))).toBe(false)
  })
})

describe('migrateGlobalConfigToSettings', () => {
  /** Seed a base-aware config dir (`<base>/<name>/<file>`). */
  function seedBaseDir(name: string, file: string, body: string): void {
    const dir = join(base, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, file), body, 'utf-8')
  }

  /** Seed a base-aware config file (`<base>/<name>`). */
  function seedBaseFile(name: string, body: string): void {
    writeFileSync(join(base, name), body, 'utf-8')
  }

  const settled = (name: string): string => join(getSettingsDir(db), name)

  it('moves all five config items into .settings/ on a fresh install', () => {
    seedBaseDir('skills', 'my-skill.md', 'skill')
    seedBaseDir('plugins', 'manifest.json', 'plugin')
    seedBaseDir('agents', 'worker.md', 'agent')
    seedBaseFile('theme.json', '{"radius":"1rem"}')
    writeFileSync(join(legacyHome, 'mcp.json'), '{"mcpServers":{}}', 'utf-8')

    migrateGlobalConfigToSettings(db, legacyHome)

    // Each item now lives under `.settings/` with its content intact...
    expect(readFileSync(join(settled('skills'), 'my-skill.md'), 'utf-8')).toBe('skill')
    expect(readFileSync(join(settled('plugins'), 'manifest.json'), 'utf-8')).toBe('plugin')
    expect(readFileSync(join(settled('agents'), 'worker.md'), 'utf-8')).toBe('agent')
    expect(readFileSync(settled('theme.json'), 'utf-8')).toBe('{"radius":"1rem"}')
    expect(readFileSync(settled('mcp.json'), 'utf-8')).toBe('{"mcpServers":{}}')

    // ...and the legacy sources are gone.
    expect(existsSync(join(base, 'skills'))).toBe(false)
    expect(existsSync(join(base, 'plugins'))).toBe(false)
    expect(existsSync(join(base, 'agents'))).toBe(false)
    expect(existsSync(join(base, 'theme.json'))).toBe(false)
    expect(existsSync(join(legacyHome, 'mcp.json'))).toBe(false)
  })

  it('is a clean no-op on a second run (already migrated)', () => {
    seedBaseDir('skills', 'my-skill.md', 'skill')
    seedBaseFile('theme.json', 'theme')
    writeFileSync(join(legacyHome, 'mcp.json'), 'mcp', 'utf-8')

    migrateGlobalConfigToSettings(db, legacyHome)
    // Second run: sources are absent, destinations present — nothing changes.
    expect(() => migrateGlobalConfigToSettings(db, legacyHome)).not.toThrow()

    expect(readFileSync(join(settled('skills'), 'my-skill.md'), 'utf-8')).toBe('skill')
    expect(readFileSync(settled('theme.json'), 'utf-8')).toBe('theme')
    expect(readFileSync(settled('mcp.json'), 'utf-8')).toBe('mcp')
  })

  it('is self-healing: never overwrites an existing destination, merges dir leftovers', () => {
    // Destination already has a `skills/` (partial prior run) with one file...
    mkdirSync(settled('skills'), { recursive: true })
    writeFileSync(join(settled('skills'), 'shared.md'), 'current', 'utf-8')
    // ...and a `theme.json` already moved.
    mkdirSync(getSettingsDir(db), { recursive: true })
    writeFileSync(settled('theme.json'), 'current-theme', 'utf-8')

    // Legacy still has a colliding file + a legacy-only file, plus a stale theme.json.
    seedBaseDir('skills', 'shared.md', 'legacy')
    seedBaseDir('skills', 'legacy-only.md', 'legacy-only')
    seedBaseFile('theme.json', 'legacy-theme')

    migrateGlobalConfigToSettings(db, legacyHome)

    // Existing destination file preserved; legacy-only file merged in.
    expect(readFileSync(join(settled('skills'), 'shared.md'), 'utf-8')).toBe('current')
    expect(readFileSync(join(settled('skills'), 'legacy-only.md'), 'utf-8')).toBe('legacy-only')
    // File destination wins; legacy theme.json left untouched (never overwritten).
    expect(readFileSync(settled('theme.json'), 'utf-8')).toBe('current-theme')
    expect(readFileSync(join(base, 'theme.json'), 'utf-8')).toBe('legacy-theme')
    // The merged-out legacy file is gone; the colliding one stayed behind.
    expect(existsSync(join(base, 'skills', 'shared.md'))).toBe(true)
    expect(existsSync(join(base, 'skills', 'legacy-only.md'))).toBe(false)
  })

  it('never relocates a folder registered as a workspace, even if its basename matches', () => {
    // A workspace legitimately lives at `<base>/skills` (basename collides with the
    // allowlist). It must be left exactly where it is.
    const skillsWsPath = join(base, 'skills')
    mkdirSync(skillsWsPath, { recursive: true })
    writeFileSync(join(skillsWsPath, 'note.md'), 'workspace-note', 'utf-8')
    createWorkspace(db, { name: 'Skills WS', path: skillsWsPath })

    migrateGlobalConfigToSettings(db, legacyHome)

    // The workspace folder is untouched; nothing was moved into `.settings/skills`.
    expect(readFileSync(join(skillsWsPath, 'note.md'), 'utf-8')).toBe('workspace-note')
    expect(existsSync(settled('skills'))).toBe(false)
  })

  it('respects the agentBaseDir override and reconciles the homedir-sourced mcp.json', () => {
    // base is already an override (temp dir, set in beforeEach). The legacy
    // mcp.json lives in the separate homedir-stand-in; it must land under the
    // active base `.settings/`.
    seedBaseDir('skills', 'my-skill.md', 'skill')
    writeFileSync(join(legacyHome, 'mcp.json'), 'mcp-from-home', 'utf-8')

    migrateGlobalConfigToSettings(db, legacyHome)

    expect(getSettingsDir(db)).toBe(join(base, '.settings'))
    expect(readFileSync(settled('mcp.json'), 'utf-8')).toBe('mcp-from-home')
    expect(readFileSync(join(settled('skills'), 'my-skill.md'), 'utf-8')).toBe('skill')
    expect(existsSync(join(legacyHome, 'mcp.json'))).toBe(false)
  })
})
