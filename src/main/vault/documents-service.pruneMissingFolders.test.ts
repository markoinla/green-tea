import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { listFolders } from '../database/repositories/folders'
import { getWorkspaceVaultDir } from './paths'
import { reindexFile, listDocuments, pruneMissingFolders } from './documents-service'

let db: Database.Database
let base: string
let workspaceId: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-prune-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'My Workspace' }).id
  vault = getWorkspaceVaultDir(db, workspaceId)
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

/** Write a .md file to disk and index it, returning its (relative) folder name. */
function seedNote(relPath: string): void {
  const abs = join(vault, relPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, `---\nid: ${randomUUID()}\n---\n\nbody\n`, 'utf-8')
  reindexFile(db, abs)
}

describe('pruneMissingFolders', () => {
  it('removes a folder row (and its docs) when its directory is deleted on disk', () => {
    seedNote('Projects/Alpha/note.md')
    expect(listFolders(db, workspaceId).map((f) => f.name)).toEqual(['Projects/Alpha'])
    expect(listDocuments(db, workspaceId)).toHaveLength(1)

    rmSync(join(vault, 'Projects'), { recursive: true, force: true })

    expect(pruneMissingFolders(db, workspaceId)).toBe(true)
    expect(listFolders(db, workspaceId)).toHaveLength(0)
    expect(listDocuments(db, workspaceId)).toHaveLength(0)
  })

  it('is a no-op (returns false) when every folder still exists', () => {
    seedNote('Projects/note.md')
    expect(pruneMissingFolders(db, workspaceId)).toBe(false)
    expect(listFolders(db, workspaceId)).toHaveLength(1)
    expect(listDocuments(db, workspaceId)).toHaveLength(1)
  })

  it('prunes only the deleted subfolder, leaving siblings intact', () => {
    seedNote('Projects/Alpha/a.md')
    seedNote('Projects/Beta/b.md')
    expect(
      listFolders(db, workspaceId)
        .map((f) => f.name)
        .sort()
    ).toEqual(['Projects/Alpha', 'Projects/Beta'])

    rmSync(join(vault, 'Projects/Alpha'), { recursive: true, force: true })

    expect(pruneMissingFolders(db, workspaceId)).toBe(true)
    expect(listFolders(db, workspaceId).map((f) => f.name)).toEqual(['Projects/Beta'])
    expect(listDocuments(db, workspaceId).map((d) => d.title)).toEqual(['b'])
  })

  it('leaves the index intact when the whole workspace folder is gone (unavailable)', () => {
    seedNote('Projects/note.md')
    rmSync(vault, { recursive: true, force: true })
    expect(pruneMissingFolders(db, workspaceId)).toBe(false)
    expect(listFolders(db, workspaceId)).toHaveLength(1)
  })
})
