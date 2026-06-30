import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../../database/__test__/setup'
import { setSetting } from '../../database/repositories/settings'
import { createWorkspace } from '../../database/repositories/workspaces'
import {
  reindexFile,
  listDocuments,
  isPathInsideAnyVault
} from '../../vault/documents-service'
import { getWorkspaceVaultDir } from '../../vault/paths'
import { notesListDocuments, notesGetMarkdown, notesSearch } from './notes-read'
import { notesProposeEdit } from './notes-write'

let db: Database.Database
let base: string
let workspaceId: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-notes-artifact-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'WS' }).id
  vault = getWorkspaceVaultDir(db, workspaceId)
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

/** Index an artifact in the vault and return its doc id. */
function indexArtifact(name = 'Report.html'): string {
  const path = join(vault, name)
  mkdirSync(vault, { recursive: true })
  writeFileSync(path, '<!doctype html><h1>Report</h1>', 'utf-8')
  utimesSync(path, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
  reindexFile(db, path)
  return listDocuments(db, workspaceId).find((d) => d.title === 'Report')!.id
}

describe('agent rules for artifacts', () => {
  it('notes_list surfaces the artifact with its kind', () => {
    const id = indexArtifact()
    const res = notesListDocuments(db, workspaceId)
    const parsed = JSON.parse(res.content) as Array<{ id: string; kind: string }>
    const entry = parsed.find((e) => e.id === id)!
    expect(entry.kind).toBe('html')
  })

  it('notes_get_markdown refuses a non-note artifact', () => {
    const id = indexArtifact()
    const res = notesGetMarkdown(db, { document_id: id }, workspaceId)
    expect(res.error).toBeDefined()
    expect(res.error).toMatch(/artifact/i)
  })

  it('notes_propose_edit refuses a non-note artifact', async () => {
    const id = indexArtifact()
    const res = await notesProposeEdit(db, { document_id: id, old_text: 'x', new_text: 'y' })
    expect(res.error).toBeDefined()
    expect(res.error).toMatch(/artifact/i)
  })

  it('notes_search excludes artifacts (content=null)', () => {
    indexArtifact()
    const res = notesSearch(db, { query: 'Report' }, workspaceId)
    expect(res.content).toBe('No results found.')
  })

  it('isPathInsideAnyVault rejects a vault-internal path, accepts an outside one', () => {
    expect(isPathInsideAnyVault(db, join(vault, 'sub', 'a.html'))).toBe(true)
    expect(isPathInsideAnyVault(db, vault)).toBe(true)
    expect(isPathInsideAnyVault(db, join(base, 'elsewhere', 'a.html'))).toBe(false)
  })
})
