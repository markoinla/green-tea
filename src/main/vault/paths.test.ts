import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { getVaultsRoot, getWorkspaceVaultDir, migrateLegacyVaultLayout } from './paths'
import { getWorkspaceDir } from '../agent/paths'
import { createWorkspace } from '../database/repositories/workspaces'

let db: Database.Database
let base: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-paths-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
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
