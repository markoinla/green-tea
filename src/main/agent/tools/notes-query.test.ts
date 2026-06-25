import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../../database/__test__/setup'
import { setSetting } from '../../database/repositories/settings'
import { createWorkspace } from '../../database/repositories/workspaces'
import { createDocument, updateFrontmatter } from '../../vault/documents-service'
import { notesQuery, notesListDocuments } from './notes-read'

let db: Database.Database
let base: string
let workspaceId: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-notesquery-'))
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

describe('notes_query matches the EAV index', () => {
  it('filters by a property value (case-insensitive)', () => {
    const a = noteWith('A', { status: 'Draft' })
    noteWith('B', { status: 'published' })

    const res = notesQuery(db, { key: 'status', value: 'draft' }, workspaceId)
    expect(res.error).toBeUndefined()
    expect(res.content).toContain(a)
    expect(res.content).not.toContain('published')
  })

  it('matches a single tag across multi-value notes and labels frontmatter-only', () => {
    const a = noteWith('A', { tags: ['Research', 'green-tea'] })
    const b = noteWith('B', { tags: ['research'] })
    noteWith('C', { tags: ['ideas'] })

    const res = notesQuery(db, { key: 'tags', value: 'research' }, workspaceId)
    expect(res.content).toContain(a)
    expect(res.content).toContain(b)
    expect(res.content).toContain('frontmatter tags only')
  })

  it('matches coerced TEXT for number/date', () => {
    const a = noteWith('A', { priority: 2 })
    noteWith('B', { priority: 3 })

    const res = notesQuery(db, { key: 'priority', value: '2' }, workspaceId)
    expect(res.content).toContain(a)
  })

  it('returns a no-match message for an unused value', () => {
    noteWith('A', { status: 'draft' })
    const res = notesQuery(db, { key: 'status', value: 'archived' }, workspaceId)
    expect(res.content).toContain('No notes match')
  })

  it('is scoped to the workspace', () => {
    const other = createWorkspace(db, { name: 'Other' }).id
    const a = noteWith('A', { status: 'draft' })
    const otherDoc = createDocument(db, { title: 'X', workspace_id: other })
    updateFrontmatter(db, otherDoc.id, { status: 'draft' })

    const res = notesQuery(db, { key: 'status', value: 'draft' }, workspaceId)
    expect(res.content).toContain(a)
    expect(res.content).not.toContain(otherDoc.id)
  })

  it('errors on missing key', () => {
    expect(notesQuery(db, { key: '', value: 'x' }, workspaceId).error).toBeTruthy()
  })
})

describe('notes_list is enriched with tags + indexed properties', () => {
  it('includes a tags array and a properties object per note', () => {
    noteWith('A', { status: 'draft', priority: 2, tags: ['research', 'green-tea'] })

    const res = notesListDocuments(db, workspaceId)
    const parsed = JSON.parse(res.content) as Array<{
      id: string
      tags: string[]
      properties: Record<string, unknown>
    }>
    expect(parsed).toHaveLength(1)
    expect(new Set(parsed[0].tags)).toEqual(new Set(['research', 'green-tea']))
    expect(parsed[0].properties.status).toBe('draft')
    expect(parsed[0].properties.priority).toBe('2')
    // tags are not duplicated into the generic properties object
    expect(parsed[0].properties.tags).toBeUndefined()
  })

  it('reports an empty tags array for a note with no tags', () => {
    noteWith('A', { status: 'draft' })
    const parsed = JSON.parse(notesListDocuments(db, workspaceId).content) as Array<{
      tags: string[]
    }>
    expect(parsed[0].tags).toEqual([])
  })
})
