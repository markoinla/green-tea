import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { markdownToTiptap } from '../markdown/tiptap-markdown'
import { getWorkspaceVaultDir, ensureVaultDir } from './paths'
import {
  buildFtsMatch,
  createDocument,
  updateDocument,
  searchDocuments,
  getBacklinks,
  getOutgoingLinks,
  reindexFile,
  reindexWorkspace,
  deleteIndexRowByPath
} from './documents-service'
import { notesSearch } from '../agent/tools/notes-read'

let db: Database.Database
let base: string
let workspaceId: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-fts-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'My Workspace' }).id
  vault = ensureVaultDir(getWorkspaceVaultDir(db, workspaceId))
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

const content = (md: string): string => JSON.stringify(markdownToTiptap(md))

describe('buildFtsMatch', () => {
  it('quotes and prefixes each word token, ANDed together', () => {
    expect(buildFtsMatch('hello world')).toBe('"hello"* "world"*')
  })

  it('returns null for empty / whitespace-only / punctuation-only input', () => {
    expect(buildFtsMatch('')).toBeNull()
    expect(buildFtsMatch('   ')).toBeNull()
    expect(buildFtsMatch('* ( ) -')).toBeNull()
    expect(buildFtsMatch('"')).toBeNull()
  })

  it('escapes internal double-quotes by doubling and keeps operator words literal', () => {
    expect(buildFtsMatch('a"b')).toBe('"a""b"*')
    // AND is wrapped as a literal string, not interpreted as an FTS operator.
    expect(buildFtsMatch('foo AND bar')).toBe('"foo"* "AND"* "bar"*')
  })
})

describe('note_links auto-heal invariant', () => {
  it('finds a backlink once the target is created, without reindexing the source', () => {
    // A links to B before B exists.
    const a = createDocument(db, {
      title: 'Alpha',
      workspace_id: workspaceId,
      content: content('Points at [[Beta]] here')
    })
    expect(getOutgoingLinks(db, a.id).map((l) => l.id)).toEqual([null]) // broken link

    // Creating B heals the inbound link with no write to A.
    const b = createDocument(db, { title: 'Beta', workspace_id: workspaceId })
    const back = getBacklinks(db, b.id)
    expect(back).toHaveLength(1)
    expect(back[0].title).toBe('Alpha')
    expect(back[0].snippet).toContain('[[Beta]]')
  })
})

describe('rename breaks inbound links', () => {
  it('drops the backlink when the target is renamed away from the label', () => {
    const b = createDocument(db, { title: 'Beta', workspace_id: workspaceId })
    createDocument(db, {
      title: 'Alpha',
      workspace_id: workspaceId,
      content: content('Points at [[Beta]] here')
    })
    expect(getBacklinks(db, b.id)).toHaveLength(1)

    updateDocument(db, b.id, { title: 'Beta Prime' })
    expect(getBacklinks(db, b.id)).toEqual([])
  })
})

describe('dedup and self-link exclusion', () => {
  it('stores one edge for a label linked twice', () => {
    const a = createDocument(db, {
      title: 'Alpha',
      workspace_id: workspaceId,
      content: content('See [[Beta]] and again [[Beta]]')
    })
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM note_links WHERE source_id = ?')
      .get(a.id) as { c: number }
    expect(count.c).toBe(1)
  })

  it('excludes self-links from backlinks', () => {
    const a = createDocument(db, {
      title: 'Alpha',
      workspace_id: workspaceId,
      content: content('A self [[Alpha]] reference')
    })
    expect(getBacklinks(db, a.id)).toEqual([])
  })
})

describe('Unicode fold (case-correct, not lower())', () => {
  it('resolves [[CAFÉ]] / [[café]] to a note titled Café via title_fold', () => {
    const cafe = createDocument(db, { title: 'Café', workspace_id: workspaceId })
    createDocument(db, {
      title: 'Upper',
      workspace_id: workspaceId,
      content: content('Visit [[CAFÉ]] today')
    })
    createDocument(db, {
      title: 'Lower',
      workspace_id: workspaceId,
      content: content('Visit [[café]] today')
    })

    const titles = getBacklinks(db, cafe.id)
      .map((b) => b.title)
      .sort()
    expect(titles).toEqual(['Lower', 'Upper'])
  })
})

describe('full-text search ranking and prefix', () => {
  it('ranks a title hit above a body-only hit', () => {
    createDocument(db, { title: 'Zebra', workspace_id: workspaceId, content: content('nothing') })
    createDocument(db, {
      title: 'Other',
      workspace_id: workspaceId,
      content: content('a zebra appears in the body')
    })

    const results = searchDocuments(db, 'zebra')
    expect(results.map((r) => r.title)).toEqual(['Zebra', 'Other'])
  })

  it('matches by prefix: ind finds Index', () => {
    createDocument(db, { title: 'Index Page', workspace_id: workspaceId })
    const results = searchDocuments(db, 'ind')
    expect(results.map((r) => r.title)).toContain('Index Page')
  })

  it('returns recent docs for an empty query, nothing for an unusable one', () => {
    createDocument(db, { title: 'Anything', workspace_id: workspaceId })
    // Empty / whitespace = the menu's open state -> show recent documents.
    expect(searchDocuments(db, '   ').map((r) => r.title)).toContain('Anything')
    // Typed but unusable (only punctuation) -> no matches.
    expect(searchDocuments(db, '*')).toEqual([])
  })
})

describe('artifacts in search', () => {
  it('command menu finds an artifact by title; agent search excludes it', () => {
    const path = join(vault, 'Quarterly Report.html')
    writeFileSync(path, '<!doctype html><html><body><h1>Report</h1></body></html>', 'utf-8')
    reindexFile(db, path)

    const menu = searchDocuments(db, 'quarterly')
    expect(menu.map((r) => r.title)).toContain('Quarterly Report')

    const agent = notesSearch(db, { query: 'quarterly' }, workspaceId)
    expect(agent.content).toBe('No results found.')
  })

  it('indexes an artifact title into FTS via the reindexWorkspace path', () => {
    // Drop an artifact on disk and rebuild the whole workspace (startup path).
    writeFileSync(
      join(vault, 'Budget Sheet.csv'),
      'name,amount\nfoo,1\n',
      'utf-8'
    )
    reindexWorkspace(db, workspaceId)

    const ftsRow = db
      .prepare("SELECT title, body FROM notes_fts WHERE title = 'Budget Sheet'")
      .get() as { title: string; body: string } | undefined
    expect(ftsRow?.title).toBe('Budget Sheet')
    expect(ftsRow?.body).toBe('') // artifacts carry an empty body
    expect(searchDocuments(db, 'budget').map((r) => r.title)).toContain('Budget Sheet')
  })
})

describe('query safety', () => {
  it('does not throw on special characters and returns sane results', () => {
    createDocument(db, {
      title: 'Special',
      workspace_id: workspaceId,
      content: content('contains index and other words')
    })
    expect(() => searchDocuments(db, '"index" * ( AND')).not.toThrow()
    const results = searchDocuments(db, '"index" * ( AND')
    expect(Array.isArray(results)).toBe(true)
  })
})

describe('deleteIndexRow cleans derived rows', () => {
  const ftsCount = (id: string): number =>
    (db.prepare('SELECT COUNT(*) AS c FROM notes_fts WHERE id = ?').get(id) as { c: number }).c
  const linkCount = (id: string): number =>
    (
      db.prepare('SELECT COUNT(*) AS c FROM note_links WHERE source_id = ?').get(id) as {
        c: number
      }
    ).c

  it('removes notes_fts and note_links rows on prune', () => {
    const a = createDocument(db, {
      title: 'Alpha',
      workspace_id: workspaceId,
      content: content('Links [[Beta]]')
    })
    expect(ftsCount(a.id)).toBe(1)
    expect(linkCount(a.id)).toBe(1)

    // Prune via the watcher path (deleteIndexRowByPath -> deleteIndexRow), which
    // does not touch Electron's shell.trashItem.
    unlinkSync(a.file_path!)
    deleteIndexRowByPath(db, a.file_path!)
    expect(ftsCount(a.id)).toBe(0)
    expect(linkCount(a.id)).toBe(0)
  })
})
