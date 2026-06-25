import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
  utimesSync,
  mkdirSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { getVaultsRoot, getWorkspaceVaultDir } from './paths'
import { MAX_NOTE_BYTES } from './note-store'
import {
  createDocument,
  listDocuments,
  reindexFile,
  deleteIndexRowByPath
} from './documents-service'

let db: Database.Database
let base: string
let workspaceId: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-reindexfile-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'My Workspace' }).id
  vault = getWorkspaceVaultDir(db, workspaceId)
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

/** Write a .md file directly to disk (simulating an external editor). */
function writeExternal(filePath: string, opts: { id?: string; body: string }): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const lines = ['---']
  if (opts.id) lines.push(`id: ${opts.id}`)
  lines.push('created: 2026-01-01T00:00:00.000Z')
  lines.push('updated: 2026-01-01T00:00:00.000Z')
  lines.push('---', '', opts.body, '')
  writeFileSync(filePath, lines.join('\n'), 'utf-8')
}

describe('reindexFile', () => {
  it('create: indexes a brand-new external .md', () => {
    const id = randomUUID()
    const path = join(vault, 'External Note.md')
    writeExternal(path, { id, body: '## Heading\n\nbody text' })

    const res = reindexFile(db, path)
    expect(res.kind).toBe('created')
    if (res.kind === 'created') expect(res.structuralChanged).toBe(true)

    const docs = listDocuments(db, workspaceId)
    expect(docs).toHaveLength(1)
    expect(docs[0].title).toBe('External Note')
    expect(docs[0].id).toBe(id)
  })

  it('update (content only): refreshes content, structuralChanged=false', () => {
    const doc = createDocument(db, { title: 'Note', workspace_id: workspaceId })
    writeExternal(doc.file_path!, { id: doc.id, body: 'edited externally' })

    const res = reindexFile(db, doc.file_path!)
    expect(res.kind).toBe('updated')
    if (res.kind === 'updated') expect(res.structuralChanged).toBe(false)
  })

  it('update (structural): a rename to a new filename changes the title', () => {
    const doc = createDocument(db, { title: 'Original', workspace_id: workspaceId })
    rmSync(doc.file_path!, { force: true })
    const renamed = join(vault, 'Renamed.md')
    writeExternal(renamed, { id: doc.id, body: 'same note, new name' })

    const res = reindexFile(db, renamed)
    expect(res.kind).toBe('updated')
    if (res.kind === 'updated') expect(res.structuralChanged).toBe(true)
    const docs = listDocuments(db, workspaceId)
    expect(docs).toHaveLength(1)
    expect(docs[0].title).toBe('Renamed')
    expect(docs[0].id).toBe(doc.id)
  })

  it('external rename processed old-path-first keeps the row (no spurious drop)', () => {
    // An external move emits two events at distinct paths in arbitrary order.
    // In the "old first" ordering the deferred-prune design must not drop the
    // still-valid note: reindexFile(old) only reports, the new path re-homes the
    // row by frontmatter id, and the settle-time prune of the old path no-ops.
    const doc = createDocument(db, { title: 'Original', workspace_id: workspaceId })
    const oldPath = doc.file_path!
    const newPath = join(vault, 'Renamed.md')
    writeExternal(newPath, { id: doc.id, body: 'moved' })
    rmSync(oldPath, { force: true })

    // old-path event first: reports deleted, prunes nothing.
    expect(reindexFile(db, oldPath).kind).toBe('deleted')
    // new-path event: re-homes the same row by id.
    expect(reindexFile(db, newPath).kind).toBe('updated')
    // settle-time prune of the old path finds no row (file_path already moved).
    expect(deleteIndexRowByPath(db, oldPath)).toBe(null)

    const docs = listDocuments(db, workspaceId)
    expect(docs).toHaveLength(1)
    expect(docs[0].id).toBe(doc.id)
    expect(docs[0].title).toBe('Renamed')
  })

  it('delete: reports the missing file but defers the prune to the watcher', () => {
    const doc = createDocument(db, { title: 'Doomed', workspace_id: workspaceId })
    rmSync(doc.file_path!, { force: true })

    // reindexFile reports the deletion but does NOT prune the row itself — that
    // way a transient disappearance (rename / atomic replace) can't drop a live
    // row. The watcher commits the prune only after the absence settles.
    const res = reindexFile(db, doc.file_path!)
    expect(res.kind).toBe('deleted')
    if (res.kind === 'deleted') expect(res.docId).toBe(doc.id)
    expect(listDocuments(db, workspaceId)).toHaveLength(1)

    // The deferred prune (what the watcher runs once the file stays gone).
    expect(deleteIndexRowByPath(db, doc.file_path!)).toBe(doc.id)
    expect(listDocuments(db, workspaceId)).toHaveLength(0)
  })

  it('unchanged (C1 echo regression): an app write does not look changed even with a newer mtime', () => {
    const doc = createDocument(db, { title: 'Stable', workspace_id: workspaceId })
    // Force the file mtime well ahead of the index updated_at — if the diff
    // included updated_at, this would falsely report "updated" (an echo).
    const future = new Date(Date.now() + 10_000)
    utimesSync(doc.file_path!, future, future)

    const res = reindexFile(db, doc.file_path!)
    expect(res.kind).toBe('unchanged')
  })

  it('persistBackfill=false: reindexing a foreign file never writes to disk', () => {
    const path = join(vault, 'Foreign.md')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '# Foreign\n\nno frontmatter here\n', 'utf-8')
    const before = readFileSync(path)
    const beforeMtime = statSync(path).mtimeMs

    const res = reindexFile(db, path)
    expect(res.kind).toBe('created')

    // The watcher path must be a read-only observer: bytes + mtime unchanged.
    expect(readFileSync(path).equals(before)).toBe(true)
    expect(statSync(path).mtimeMs).toBe(beforeMtime)
  })

  it('unicode: an NFD-formed path resolves the same row (no duplicate)', () => {
    const title = 'Caf' + String.fromCodePoint(0x00e9) // "Café" (precomposed)
    const doc = createDocument(db, { title, workspace_id: workspaceId })
    expect(listDocuments(db, workspaceId)).toHaveLength(1)

    const nfdPath = doc.file_path!.normalize('NFD')
    const res = reindexFile(db, nfdPath)
    expect(res.kind).toBe('unchanged')
    if (res.kind === 'unchanged') expect(res.docId).toBe(doc.id)
    expect(listDocuments(db, workspaceId)).toHaveLength(1)
  })

  it('ignores a file dropped directly in the vaults root (no owning workspace)', () => {
    const loose = join(getVaultsRoot(db), 'loose.md')
    writeExternal(loose, { id: randomUUID(), body: 'orphan' })
    expect(reindexFile(db, loose).kind).toBe('ignored')
    expect(listDocuments(db)).toHaveLength(0)
  })

  it('workspace resolution: Foobar wins over Foo at the segment boundary', () => {
    const foo = createWorkspace(db, { name: 'Foo' }).id
    const foobar = createWorkspace(db, { name: 'Foobar' }).id
    const path = join(getWorkspaceVaultDir(db, foobar), 'note.md')
    writeExternal(path, { id: randomUUID(), body: 'in foobar' })

    const res = reindexFile(db, path)
    expect(res.kind).toBe('created')
    const docs = listDocuments(db, foobar)
    expect(docs).toHaveLength(1)
    expect(listDocuments(db, foo)).toHaveLength(0)
  })

  it('ignores a file larger than MAX_NOTE_BYTES', () => {
    const path = join(vault, 'Huge.md')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'x'.repeat(MAX_NOTE_BYTES + 1), 'utf-8')
    expect(reindexFile(db, path).kind).toBe('ignored')
  })
})
