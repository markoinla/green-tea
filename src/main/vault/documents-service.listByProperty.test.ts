import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import {
  createDocument,
  updateFrontmatter,
  listDocuments,
  listByProperty
} from './documents-service'

let db: Database.Database
let base: string
let workspaceId: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-listbyprop-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'WS' }).id
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

function noteWith(title: string, fm: Record<string, unknown>): string {
  const doc = createDocument(db, { title, workspace_id: workspaceId })
  updateFrontmatter(db, doc.id, fm)
  return doc.id
}

describe('listByProperty', () => {
  it('returns only the notes carrying the property value', () => {
    const a = noteWith('A', { status: 'draft' })
    const b = noteWith('B', { status: 'published' })
    noteWith('C', {})

    const draft = listByProperty(db, workspaceId, 'status', 'draft')
    expect(draft.map((d) => d.id)).toEqual([a])
    expect(draft.map((d) => d.id)).not.toContain(b)
  })

  it('matches case-insensitively (value_fold equality)', () => {
    const a = noteWith('A', { status: 'Draft' })

    expect(listByProperty(db, workspaceId, 'status', 'draft').map((d) => d.id)).toEqual([a])
    expect(listByProperty(db, workspaceId, 'status', 'DRAFT').map((d) => d.id)).toEqual([a])
    expect(listByProperty(db, workspaceId, 'status', 'DrAfT').map((d) => d.id)).toEqual([a])
  })

  it('matches a single tag across multi-value notes', () => {
    const a = noteWith('A', { tags: ['Research', 'green-tea'] })
    const b = noteWith('B', { tags: ['research'] })
    noteWith('C', { tags: ['ideas'] })

    const research = listByProperty(db, workspaceId, 'tags', 'research')
    expect(new Set(research.map((d) => d.id))).toEqual(new Set([a, b]))
    // A note is returned once even though it carries multiple tag rows.
    expect(research.filter((d) => d.id === a)).toHaveLength(1)
  })

  it('matches coerced TEXT for number/date (exact)', () => {
    const a = noteWith('A', { priority: 2, due: '2026-07-01' })
    noteWith('B', { priority: 3 })

    expect(listByProperty(db, workspaceId, 'priority', '2').map((d) => d.id)).toEqual([a])
    expect(listByProperty(db, workspaceId, 'due', '2026-07-01').map((d) => d.id)).toEqual([a])
  })

  it('is scoped to the workspace', () => {
    const other = createWorkspace(db, { name: 'Other' }).id
    const a = noteWith('A', { status: 'draft' })
    const otherDoc = createDocument(db, { title: 'X', workspace_id: other })
    updateFrontmatter(db, otherDoc.id, { status: 'draft' })

    const res = listByProperty(db, workspaceId, 'status', 'draft')
    expect(res.map((d) => d.id)).toEqual([a])
    expect(res.map((d) => d.id)).not.toContain(otherDoc.id)
  })

  it('clearing the filter (listDocuments) restores the full list', () => {
    noteWith('A', { status: 'draft' })
    noteWith('B', { status: 'published' })

    const filtered = listByProperty(db, workspaceId, 'status', 'draft')
    expect(filtered).toHaveLength(1)
    // The "clear" affordance simply falls back to the unfiltered list.
    const all = listDocuments(db, workspaceId)
    expect(all).toHaveLength(2)
  })

  it('returns an empty list for a value no note carries', () => {
    noteWith('A', { status: 'draft' })
    expect(listByProperty(db, workspaceId, 'status', 'archived')).toEqual([])
  })
})
