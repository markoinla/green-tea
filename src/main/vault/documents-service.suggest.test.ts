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
  setPropertyType,
  tagSuggest,
  propertyNameSuggest
} from './documents-service'

let db: Database.Database
let base: string
let workspaceId: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-suggest-'))
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

describe('tagSuggest', () => {
  it('aggregates the workspace-global tag set, most-frequent display first', () => {
    noteWith('A', { tags: ['Research', 'green-tea'] })
    noteWith('B', { tags: ['research', 'ideas'] })
    noteWith('C', { tags: ['Research'] })

    const all = tagSuggest(db, workspaceId)
    // Research appears 3x (folds together): most frequent first. Display string is
    // the most-frequent original — "Research" (2) beats "research" (1).
    expect(all[0]).toBe('Research')
    expect(all).toContain('green-tea')
    expect(all).toContain('ideas')
    // One entry per fold group (no duplicate research spellings).
    expect(all.filter((t) => t.toLowerCase() === 'research')).toEqual(['Research'])
  })

  it('filters by case-insensitive prefix', () => {
    noteWith('A', { tags: ['Research', 'green-tea', 'ideas'] })
    const res = tagSuggest(db, workspaceId, 'RES')
    expect(res).toEqual(['Research'])
  })

  it('strips a leading hash so #research and research are one tag', () => {
    noteWith('A', { tags: ['#research'] })
    noteWith('B', { tags: ['research'] })
    const res = tagSuggest(db, workspaceId)
    expect(res).toEqual(['research'])
  })

  it('aliases the singular tag key to tags', () => {
    noteWith('A', { tag: 'solo' })
    expect(tagSuggest(db, workspaceId)).toContain('solo')
  })
})

describe('propertyNameSuggest', () => {
  it('returns the union of registry + indexed keys, excluding reserved', () => {
    noteWith('A', { status: 'draft', priority: 1 })
    setPropertyType(db, workspaceId, 'category', 'text')
    const names = propertyNameSuggest(db, workspaceId)
    expect(names).toEqual(['category', 'priority', 'status'])
    expect(names).not.toContain('id')
    expect(names).not.toContain('title')
  })

  it('filters by prefix', () => {
    noteWith('A', { status: 'draft', priority: 1 })
    expect(propertyNameSuggest(db, workspaceId, 'pri')).toEqual(['priority'])
  })
})
