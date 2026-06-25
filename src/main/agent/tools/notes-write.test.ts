import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../../database/__test__/setup'
import { setSetting } from '../../database/repositories/settings'
import { createWorkspace } from '../../database/repositories/workspaces'
import {
  listDocuments,
  getDocument,
  reindexWorkspace
} from '../../vault/documents-service'
import { notesCreateDocument } from './notes-write'

let db: Database.Database
let base: string
let workspaceId: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-noteswrite-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'WS' }).id
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

describe('agent notes_create is file-backed (regression: notes must not vanish)', () => {
  it('persists an agent-created note to disk so it survives open + reindex', () => {
    const res = notesCreateDocument(
      db,
      { title: 'Agent Note', markdown: '## Heading\n\nbody text' },
      workspaceId
    )
    expect(res.error).toBeUndefined()

    const docs = listDocuments(db, workspaceId)
    expect(docs).toHaveLength(1)
    const id = docs[0].id
    // The row is backed by a real file (not a NULL file_path that gets pruned).
    expect(docs[0].file_path).toBeTruthy()

    // Opening it does NOT prune it (the bug was: get -> prune -> undefined).
    expect(getDocument(db, id)).toBeDefined()

    // And it survives a from-disk reindex (simulated relaunch).
    reindexWorkspace(db, workspaceId)
    expect(getDocument(db, id)).toBeDefined()
    expect(listDocuments(db, workspaceId)).toHaveLength(1)
  })
})
