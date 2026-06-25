import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { getWorkspaceVaultDir } from './paths'
import {
  getDocument,
  updateDocument,
  updateFrontmatter,
  reindexFile,
  reindexWorkspace,
  listDocuments
} from './documents-service'

let db: Database.Database
let base: string
let workspaceId: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-artifact-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'My Workspace' }).id
  vault = getWorkspaceVaultDir(db, workspaceId)
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

/** Write an artifact to disk with an explicit, deterministic mtime. */
function writeHtml(filePath: string, html: string, mtime: Date): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, html, 'utf-8')
  utimesSync(filePath, mtime, mtime)
}

const T1 = new Date('2026-01-01T00:00:00.000Z')
const T2 = new Date('2026-02-02T00:00:00.000Z')
const HTML = '<!doctype html><html><body><h1>Report</h1></body></html>'

describe('artifact reindexFile', () => {
  it('indexes a new .html as an artifact: kind=html, content=null', () => {
    const path = join(vault, 'Report.html')
    writeHtml(path, HTML, T1)

    const res = reindexFile(db, path)
    expect(res.kind).toBe('created')

    const docs = listDocuments(db, workspaceId)
    expect(docs).toHaveLength(1)
    expect(docs[0].title).toBe('Report')
    expect(docs[0].kind).toBe('html')
    expect(docs[0].content).toBeNull()
  })

  it('rewrite at the same path keeps the id and reports updated (live reload)', () => {
    const path = join(vault, 'Report.html')
    writeHtml(path, HTML, T1)
    const first = reindexFile(db, path)
    const id = 'docId' in first ? first.docId : ''
    expect(id).not.toBe('')

    // Agent regenerates the file: same path, new bytes, newer mtime.
    writeHtml(path, HTML + '<!-- v2 -->', T2)
    const second = reindexFile(db, path)
    expect(second.kind).toBe('updated')
    expect('docId' in second && second.docId).toBe(id) // SAME id, for free
  })

  it('an unchanged file (same mtime) reports unchanged — no spurious reload', () => {
    const path = join(vault, 'Report.html')
    writeHtml(path, HTML, T1)
    reindexFile(db, path)
    const again = reindexFile(db, path)
    expect(again.kind).toBe('unchanged')
  })

  it('the indexer NEVER writes to an artifact file (read-only invariant)', () => {
    const path = join(vault, 'Report.html')
    writeHtml(path, HTML, T1)
    const before = readFileSync(path, 'utf-8')

    reindexFile(db, path)
    getDocument(db, listDocuments(db, workspaceId)[0].id)

    expect(readFileSync(path, 'utf-8')).toBe(before) // byte-identical: no frontmatter injected
  })

  it('a moved file (new path) mints a fresh id — path-based identity', () => {
    const a = join(vault, 'Report.html')
    writeHtml(a, HTML, T1)
    const first = reindexFile(db, a)
    const id1 = 'docId' in first ? first.docId : ''

    const b = join(vault, 'Renamed.html')
    writeHtml(b, HTML, T1)
    const second = reindexFile(db, b)
    expect('docId' in second && second.docId).not.toBe(id1)
  })
})

describe('artifact reindexWorkspace', () => {
  it('indexes .md as a note and .html as an artifact side by side', () => {
    mkdirSync(vault, { recursive: true })
    writeFileSync(join(vault, 'Plan.md'), '---\nid: n1\n---\n\n# Plan\n\nbody', 'utf-8')
    writeHtml(join(vault, 'Dash.html'), HTML, T1)

    reindexWorkspace(db, workspaceId)
    const docs = listDocuments(db, workspaceId)
    const note = docs.find((d) => d.title === 'Plan')!
    const art = docs.find((d) => d.title === 'Dash')!

    expect(note.kind).toBe('note')
    expect(note.content).not.toBeNull()
    expect(art.kind).toBe('html')
    expect(art.content).toBeNull()
  })
})

describe('artifact getDocument / updateDocument / updateFrontmatter', () => {
  function indexArtifact(): string {
    const path = join(vault, 'Report.html')
    writeHtml(path, HTML, T1)
    reindexFile(db, path)
    return listDocuments(db, workspaceId)[0].id
  }

  it('getDocument returns artifact metadata with content=null and no write-back', () => {
    const id = indexArtifact()
    const doc = getDocument(db, id)!
    expect(doc.kind).toBe('html')
    expect(doc.content).toBeNull()
  })

  it('renaming an artifact preserves its extension and bytes, drops the original', () => {
    const id = indexArtifact()
    const oldPath = join(vault, 'Report.html')
    const before = readFileSync(oldPath, 'utf-8')

    const updated = updateDocument(db, id, { title: 'Quarterly Report' })

    expect(updated.id).toBe(id) // id kept (in-app rename)
    expect(updated.kind).toBe('html')
    expect(updated.content).toBeNull()
    expect(updated.file_path!.endsWith('.html')).toBe(true) // NOT .md
    expect(existsSync(oldPath)).toBe(false) // original moved, not duplicated
    const newPath = updated.file_path!
    expect(readFileSync(newPath, 'utf-8')).toBe(before) // bytes untouched (no frontmatter)
    expect(readFileSync(newPath, 'utf-8').startsWith('---')).toBe(false)
  })

  it('updateFrontmatter refuses an artifact (no markdown rewrite)', () => {
    const id = indexArtifact()
    expect(() => updateFrontmatter(db, id, { tags: ['x'] })).toThrow(/artifact/i)
    // The file is still pristine HTML.
    expect(readFileSync(join(vault, 'Report.html'), 'utf-8')).toBe(HTML)
  })
})
