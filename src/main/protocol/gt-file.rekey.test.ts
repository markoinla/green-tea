import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { addWorkspaceFile } from '../database/repositories/workspace-files'
import { createDocument, reindexFile, listDocuments } from '../vault/documents-service'
import { getWorkspaceVaultDir } from '../vault/paths'
import { resolveGtFilePath } from './gt-file'

let db: Database.Database
let base: string
let workspaceId: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-rekey-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'WS' }).id
  vault = getWorkspaceVaultDir(db, workspaceId)
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

describe('resolveGtFilePath (v2 re-key)', () => {
  it('resolves a document-tree artifact id to its file_path', () => {
    const path = join(vault, 'Report.html')
    mkdirSync(vault, { recursive: true })
    writeFileSync(path, '<h1>x</h1>', 'utf-8')
    utimesSync(path, new Date('2026-01-01Z'), new Date('2026-01-01Z'))
    reindexFile(db, path)
    const id = listDocuments(db, workspaceId)[0].id

    expect(resolveGtFilePath(db, id)).toBe(path)
  })

  it('REFUSES a note doc id (never serves raw markdown)', () => {
    const note = createDocument(db, { title: 'A Note', workspace_id: workspaceId })
    expect(resolveGtFilePath(db, note.id)).toBeNull()
  })

  it('still resolves a flat workspace-file id (v1 path preserved)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'gt-rekey-out-'))
    const path = join(outside, 'index.html')
    writeFileSync(path, '<h1>y</h1>', 'utf-8')
    const row = addWorkspaceFile(db, {
      workspace_id: workspaceId,
      file_path: path,
      file_name: 'index.html'
    })
    expect(resolveGtFilePath(db, row.id)).toBe(path)
    rmSync(outside, { recursive: true, force: true })
  })

  it('returns null for an unknown id', () => {
    expect(resolveGtFilePath(db, 'nope')).toBeNull()
  })
})
