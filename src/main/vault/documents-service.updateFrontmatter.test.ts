import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { getWorkspaceVaultDir } from './paths'
import { markdownToTiptap } from '../markdown/tiptap-markdown'
import { parseFrontmatter } from '../markdown/frontmatter'
import {
  createDocument,
  getDocument,
  updateFrontmatter,
  updateDocument,
  getPropertyTypes,
  setPropertyType
} from './documents-service'

let db: Database.Database
let base: string
let workspaceId: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-fm-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'My Workspace' }).id
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

const content = (md: string): string => JSON.stringify(markdownToTiptap(md))

function diskFrontmatter(filePath: string): Record<string, unknown> {
  return parseFrontmatter(readFileSync(filePath, 'utf-8')).data
}

describe('updateFrontmatter — merge semantics', () => {
  it('merges only changed keys, preserving unrelated properties and reserved keys', () => {
    const doc = createDocument(db, {
      title: 'Note',
      workspace_id: workspaceId,
      content: content('# Note\n\nbody')
    })
    // Seed two user properties.
    updateFrontmatter(db, doc.id, { status: 'draft', priority: 2 })
    // Now change only one of them.
    const { document } = updateFrontmatter(db, doc.id, { status: 'published' })

    const fm = diskFrontmatter(document.file_path!)
    expect(fm.status).toBe('published')
    expect(fm.priority).toBe(2) // unrelated property preserved
    // Reserved keys preserved on disk and authoritative.
    expect(fm.id).toBe(doc.id)
    expect(typeof fm.created).toBe('string')
    expect(typeof fm.updated).toBe('string')

    expect(document.frontmatter?.status).toBe('published')
    expect(document.frontmatter?.priority).toBe(2)
  })

  it('clears a property when the value is null', () => {
    const doc = createDocument(db, {
      title: 'Clearable',
      workspace_id: workspaceId,
      content: content('# Clearable')
    })
    updateFrontmatter(db, doc.id, { status: 'draft', tags: ['a', 'b'] })
    const { document } = updateFrontmatter(db, doc.id, { status: null })
    const fm = diskFrontmatter(document.file_path!)
    expect('status' in fm).toBe(false)
    expect(fm.tags).toEqual(['a', 'b'])
  })
})

describe('updateFrontmatter — reserved-key chokepoint (M2)', () => {
  it('ignores attempts to set id/title/created/updated and reports them as rejected', () => {
    const doc = createDocument(db, {
      title: 'Reserved',
      workspace_id: workspaceId,
      content: content('# Reserved')
    })
    const originalId = doc.id
    const originalCreated = doc.created_at

    const { document, rejectedKeys } = updateFrontmatter(db, doc.id, {
      id: 'hacked-id',
      title: 'Hacked Title',
      created: '1999-01-01T00:00:00Z',
      updated: '1999-01-01T00:00:00Z',
      status: 'kept'
    })

    expect(rejectedKeys.sort()).toEqual(['created', 'id', 'title', 'updated'])

    const fm = diskFrontmatter(document.file_path!)
    expect(fm.id).toBe(originalId) // id never overwritten (index join key)
    expect(fm.created).toBe(originalCreated)
    // title is managed: when it equals the filename it's omitted from disk.
    expect(fm.title).toBeUndefined()
    expect(document.title).toBe('Reserved')
    // The one legitimate key still applies.
    expect(fm.status).toBe('kept')
    expect(document.frontmatter?.status).toBe('kept')
  })

  it('rejects reserved keys for the agent caller too (same chokepoint)', () => {
    // The agent/approval path calls updateFrontmatter directly, so it shares the
    // exact same enforcement as the renderer IPC path.
    const doc = createDocument(db, {
      title: 'AgentNote',
      workspace_id: workspaceId,
      content: content('# AgentNote')
    })
    const { rejectedKeys } = updateFrontmatter(db, doc.id, { id: 'x', area: 'research' })
    expect(rejectedKeys).toEqual(['id'])
    const fm = diskFrontmatter(getDocument(db, doc.id)!.file_path!)
    expect(fm.id).toBe(doc.id)
    expect(fm.area).toBe('research')
  })
})

describe('updateFrontmatter — index re-derivation', () => {
  it('re-derives document_properties rows after a merge', () => {
    const doc = createDocument(db, {
      title: 'Indexed',
      workspace_id: workspaceId,
      content: content('# Indexed')
    })
    updateFrontmatter(db, doc.id, { tags: ['Research', 'Green-Tea'] })
    const rows = db
      .prepare('SELECT key, value, value_fold FROM document_properties WHERE document_id = ?')
      .all(doc.id) as { key: string; value: string; value_fold: string }[]
    const tagRows = rows.filter((r) => r.key === 'tags')
    expect(tagRows.map((r) => r.value).sort()).toEqual(['Green-Tea', 'Research'])
    expect(tagRows.map((r) => r.value_fold).sort()).toEqual(['green-tea', 'research'])
  })
})

describe('setPropertyType — registry + index without file writes', () => {
  it('sets user_set=1 and re-derives value_type without touching files', () => {
    const doc = createDocument(db, {
      title: 'Typed',
      workspace_id: workspaceId,
      content: content('# Typed')
    })
    // "2" infers as number; seed it.
    updateFrontmatter(db, doc.id, { priority: 2 })
    const seeded = getPropertyTypes(db, workspaceId).find((t) => t.key === 'priority')
    expect(seeded?.type).toBe('number')
    expect(seeded?.user_set).toBe(0)

    // Capture the file mtime/contents before the type change.
    const filePath = getDocument(db, doc.id)!.file_path!
    const before = readFileSync(filePath, 'utf-8')
    const vault = getWorkspaceVaultDir(db, workspaceId)
    const filesBefore = readdirSync(vault).sort()

    // Override the type to text.
    setPropertyType(db, workspaceId, 'priority', 'text')

    const after = getPropertyTypes(db, workspaceId).find((t) => t.key === 'priority')
    expect(after?.type).toBe('text')
    expect(after?.user_set).toBe(1)

    // EAV value_type re-derived to the new type.
    const row = db
      .prepare('SELECT value_type FROM document_properties WHERE document_id = ? AND key = ?')
      .get(doc.id, 'priority') as { value_type: string }
    expect(row.value_type).toBe('text')

    // No file writes: contents and dir listing unchanged.
    expect(readFileSync(filePath, 'utf-8')).toBe(before)
    expect(readdirSync(vault).sort()).toEqual(filesBefore)
  })

  it('a user-set type survives a subsequent body autosave (no re-seed)', () => {
    const doc = createDocument(db, {
      title: 'Persistent',
      workspace_id: workspaceId,
      content: content('# Persistent')
    })
    updateFrontmatter(db, doc.id, { count: 5 })
    setPropertyType(db, workspaceId, 'count', 'text')
    // A body autosave re-derives metadata; the user type must NOT be re-seeded.
    updateDocument(db, doc.id, { content: content('# Persistent\n\nmore body') })
    const entry = getPropertyTypes(db, workspaceId).find((t) => t.key === 'count')
    expect(entry?.type).toBe('text')
    expect(entry?.user_set).toBe(1)
  })
})
