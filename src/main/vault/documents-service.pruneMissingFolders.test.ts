import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { listFolders } from '../database/repositories/folders'
import { getWorkspaceVaultDir } from './paths'
import {
  reindexFile,
  reindexWorkspace,
  listDocuments,
  pruneMissingFolders,
  indexHasEntriesUnder,
  createFolder
} from './documents-service'

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

  it('keeps a doc whose file still exists on disk when its folder dir is gone (rename race)', () => {
    seedNote('Projects/Alpha/note.md')
    const doc = listDocuments(db, workspaceId)[0]

    // Simulate the external-rename race: the directory moved on disk and a
    // per-file reindex already re-pointed file_path at the new location, but the
    // doc's folder_id still references the old (now-missing) folder row when the
    // prune fires.
    renameSync(join(vault, 'Projects/Alpha'), join(vault, 'Projects/Beta'))
    db.prepare('UPDATE documents SET file_path = ? WHERE id = ?').run(
      join(vault, 'Projects/Beta/note.md').normalize('NFC'),
      doc.id
    )

    expect(pruneMissingFolders(db, workspaceId)).toBe(false)
    expect(listDocuments(db, workspaceId).map((d) => d.id)).toEqual([doc.id])
    // The stale folder row is kept (no dangling folder_id); reindex reconciles it.
    expect(listFolders(db, workspaceId).map((f) => f.name)).toEqual(['Projects/Alpha'])
  })
})

describe('reindexWorkspace after an external folder rename', () => {
  it('re-homes notes under the new folder with a stable doc id', () => {
    seedNote('Projects/Alpha/note.md')
    const before = listDocuments(db, workspaceId)[0]

    renameSync(join(vault, 'Projects/Alpha'), join(vault, 'Projects/Beta'))
    reindexWorkspace(db, workspaceId)

    const after = listDocuments(db, workspaceId)
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before.id)
    expect(after[0].file_path).toBe(join(vault, 'Projects/Beta/note.md'))
    const names = listFolders(db, workspaceId)
      .map((f) => f.name)
      .sort()
    expect(names).toEqual(['Projects', 'Projects/Beta'])
  })
})

describe('indexHasEntriesUnder', () => {
  it('sees an indexed doc under the path', () => {
    seedNote('Projects/Alpha/note.md')
    expect(indexHasEntriesUnder(db, workspaceId, join(vault, 'Projects'))).toBe(true)
    expect(indexHasEntriesUnder(db, workspaceId, join(vault, 'Projects/Alpha'))).toBe(true)
    expect(indexHasEntriesUnder(db, workspaceId, join(vault, 'Other'))).toBe(false)
  })

  it('sees a folder row even when the folder holds no notes', () => {
    createFolder(db, { name: 'Empty', workspace_id: workspaceId })
    expect(indexHasEntriesUnder(db, workspaceId, join(vault, 'Empty'))).toBe(true)
  })

  it('does not match a sibling path sharing a name prefix', () => {
    seedNote('Projects/Alpha/note.md')
    expect(indexHasEntriesUnder(db, workspaceId, join(vault, 'Proj'))).toBe(false)
  })
})
