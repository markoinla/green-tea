import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace, setWorkspacePath } from '../database/repositories/workspaces'
import { getDefaultWorkspaceDir } from '../agent/paths'
import { listDocuments, reindexWorkspace, isWorkspaceUnavailable } from './documents-service'

let db: Database.Database
let base: string
let picked: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-importer-'))
  picked = mkdtempSync(join(tmpdir(), 'gt-picked-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
  rmSync(picked, { recursive: true, force: true })
})

describe('open-existing importer (reindex over an arbitrary ws.path)', () => {
  it('recursively indexes .md/.html/.csv and skips dotfolders incl .greentea/', () => {
    // An existing folder full of notes + artifacts, with a hidden scratch dir.
    writeFileSync(join(picked, 'index.md'), '# index\n', 'utf-8')
    mkdirSync(join(picked, 'topics'), { recursive: true })
    writeFileSync(join(picked, 'topics', 'rag.md'), '# rag\n', 'utf-8')
    writeFileSync(join(picked, 'report.html'), '<h1>report</h1>', 'utf-8')
    writeFileSync(join(picked, 'data.csv'), 'a,b\n1,2\n', 'utf-8')
    mkdirSync(join(picked, '.greentea'), { recursive: true })
    writeFileSync(join(picked, '.greentea', 'scratch.md'), '# scratch\n', 'utf-8')

    const ws = createWorkspace(db, { name: 'Research', path: picked })
    reindexWorkspace(db, ws.id)

    const titles = listDocuments(db, ws.id)
      .map((d) => d.title)
      .sort()
    // index, rag, report, data — but NOT the .greentea/scratch note.
    expect(titles).toEqual(['data', 'index', 'rag', 'report'])
  })
})

describe('isWorkspaceUnavailable', () => {
  it('is false for a default-location workspace even when the folder is absent', () => {
    const ws = createWorkspace(db, { name: 'Journal' })
    setWorkspacePath(db, ws.id, getDefaultWorkspaceDir(db, 'Journal'))
    expect(isWorkspaceUnavailable(db, ws.id)).toBe(false)
  })

  it('is true for an arbitrary picked folder that no longer exists', () => {
    const ws = createWorkspace(db, { name: 'Gone', path: join(picked, 'nope') })
    expect(isWorkspaceUnavailable(db, ws.id)).toBe(true)
  })

  it('is false once the arbitrary folder exists on disk', () => {
    const ws = createWorkspace(db, { name: 'Here', path: picked })
    expect(isWorkspaceUnavailable(db, ws.id)).toBe(false)
  })
})
