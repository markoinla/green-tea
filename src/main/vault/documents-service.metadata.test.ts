import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { getWorkspaceVaultDir } from './paths'
import { markdownToTiptap } from '../markdown/tiptap-markdown'
import {
  createDocument,
  updateDocument,
  getDocument,
  reindexFile,
  reindexWorkspace
} from './documents-service'

let db: Database.Database
let base: string
let workspaceId: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-docsvc-meta-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'My Workspace' }).id
  vault = getWorkspaceVaultDir(db, workspaceId)
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

const content = (md: string): string => JSON.stringify(markdownToTiptap(md))

interface PropRow {
  document_id: string
  key: string
  value: string
  value_fold: string
  value_type: string
  conforms: number
}

function props(docId: string): PropRow[] {
  return db
    .prepare('SELECT * FROM document_properties WHERE document_id = ? ORDER BY key, value')
    .all(docId) as PropRow[]
}

/** Write a .md file directly to disk (external editor) with arbitrary frontmatter. */
function writeExternal(filePath: string, frontmatter: string[], body: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const lines = ['---', ...frontmatter, '---', '', body, '']
  writeFileSync(filePath, lines.join('\n'), 'utf-8')
}

describe('metadata derivation — index writers', () => {
  it('createDocument derives no rows for a frontmatter-less note', () => {
    const doc = createDocument(db, { title: 'Plain', workspace_id: workspaceId })
    expect(props(doc.id)).toHaveLength(0)
  })

  it('metadata-only external edit re-derives document_properties (C2 regression)', () => {
    const id = randomUUID()
    const path = join(vault, 'Note.md')
    writeExternal(
      path,
      [`id: ${id}`, 'created: 2026-01-01T00:00:00.000Z', 'updated: 2026-01-01T00:00:00.000Z'],
      'body'
    )
    let res = reindexFile(db, path)
    expect(res.kind).toBe('created')
    expect(props(id)).toHaveLength(0)

    // External edit that touches ONLY frontmatter (same title/content/folder).
    writeExternal(
      path,
      [
        `id: ${id}`,
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-02-01T00:00:00.000Z',
        'status: draft'
      ],
      'body'
    )
    res = reindexFile(db, path)
    expect(res.kind).toBe('updated')
    const rows = props(id)
    expect(rows.map((r) => `${r.key}=${r.value}`)).toEqual(['status=draft'])
  })

  it('a new key seeds the registry (user_set=0)', () => {
    const id = randomUUID()
    const path = join(vault, 'Seed.md')
    writeExternal(
      path,
      [
        `id: ${id}`,
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-01T00:00:00.000Z',
        'priority: 3'
      ],
      'body'
    )
    reindexFile(db, path)
    const reg = db
      .prepare('SELECT type, user_set FROM property_types WHERE workspace_id = ? AND key = ?')
      .get(workspaceId, 'priority') as { type: string; user_set: number }
    expect(reg.type).toBe('number')
    expect(reg.user_set).toBe(0)
  })

  it('conflicting value -> conforms=0 and the file is untouched (no auto type change)', () => {
    // Seed a user_set=1 number type.
    db.prepare(
      'INSERT INTO property_types (workspace_id, key, type, user_set) VALUES (?, ?, ?, 1)'
    ).run(workspaceId, 'priority', 'number')

    const id = randomUUID()
    const path = join(vault, 'Conflict.md')
    writeExternal(
      path,
      [
        `id: ${id}`,
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-01T00:00:00.000Z',
        'priority: high'
      ],
      'body'
    )
    const before = readFileSync(path, 'utf-8')
    reindexFile(db, path)

    const rows = props(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].value_type).toBe('number')
    expect(rows[0].conforms).toBe(0)

    // Registry type unchanged, user_set still 1.
    const reg = db
      .prepare('SELECT type, user_set FROM property_types WHERE workspace_id = ? AND key = ?')
      .get(workspaceId, 'priority') as { type: string; user_set: number }
    expect(reg.type).toBe('number')
    expect(reg.user_set).toBe(1)

    // File on disk is byte-identical (no rewrite from the watcher path).
    expect(readFileSync(path, 'utf-8')).toBe(before)
  })

  it('reserved keys are skipped in the EAV index', () => {
    const id = randomUUID()
    const path = join(vault, 'Reserved.md')
    writeExternal(
      path,
      [
        `id: ${id}`,
        'title: Custom Title',
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-01T00:00:00.000Z',
        'status: live'
      ],
      'body'
    )
    reindexFile(db, path)
    const keys = props(id).map((r) => r.key)
    expect(keys).toEqual(['status'])
  })

  it('list / tags produce multiple rows', () => {
    const id = randomUUID()
    const path = join(vault, 'Tags.md')
    writeExternal(
      path,
      [
        `id: ${id}`,
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-01T00:00:00.000Z',
        'tags: [research, green-tea]'
      ],
      'body'
    )
    reindexFile(db, path)
    const rows = props(id).filter((r) => r.key === 'tags')
    expect(rows.map((r) => r.value).sort()).toEqual(['green-tea', 'research'])
  })

  it('frontmatter-less note saved twice -> one stable EAV row set (L1)', () => {
    const path = join(vault, 'NoFm.md')
    // No id, no frontmatter at all — each read mints a fresh ephemeral id.
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'just body, no fence\n', 'utf-8')

    const r1 = reindexFile(db, path)
    expect(r1.kind).toBe('created')
    const docId = r1.kind === 'created' ? r1.docId : ''

    // Touch the body (content change) and reindex again — same path, same row.
    writeFileSync(path, 'just body, no fence\n\nmore\n', 'utf-8')
    const r2 = reindexFile(db, path)
    expect(r2.kind).toBe('updated')
    if (r2.kind === 'updated') expect(r2.docId).toBe(docId)

    // Exactly one index row for the path, and a stable (empty) EAV row set.
    const docRows = db
      .prepare('SELECT id FROM documents WHERE file_path = ?')
      .all(path.normalize('NFC')) as { id: string }[]
    expect(docRows).toHaveLength(1)
    expect(props(docId)).toHaveLength(0)
  })

  it('type change rewrites no files (registry-only)', () => {
    const id = randomUUID()
    const path = join(vault, 'TypeChange.md')
    writeExternal(
      path,
      [
        `id: ${id}`,
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-01T00:00:00.000Z',
        'priority: 3'
      ],
      'body'
    )
    reindexFile(db, path)
    const before = readFileSync(path, 'utf-8')

    // Simulate a user type override to text + re-derive via reindex.
    db.prepare('UPDATE property_types SET type = ?, user_set = 1 WHERE workspace_id = ? AND key = ?')
      .run('text', workspaceId, 'priority')
    reindexWorkspace(db, workspaceId)

    const rows = props(id)
    expect(rows[0].value_type).toBe('text')
    expect(readFileSync(path, 'utf-8')).toBe(before)
  })

  it('updateDocument re-derives the note rows and populates the frontmatter column', () => {
    const id = randomUUID()
    const path = join(vault, 'Update.md')
    writeExternal(
      path,
      [
        `id: ${id}`,
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-01T00:00:00.000Z',
        'status: draft'
      ],
      'body'
    )
    reindexFile(db, path)
    expect(props(id).map((r) => `${r.key}=${r.value}`)).toEqual(['status=draft'])

    // A body autosave must preserve the derived rows (Phase 0 keeps frontmatter).
    updateDocument(db, id, { content: content('new body') })
    expect(props(id).map((r) => `${r.key}=${r.value}`)).toEqual(['status=draft'])

    const row = db.prepare('SELECT frontmatter FROM documents WHERE id = ?').get(id) as {
      frontmatter: string
    }
    expect(JSON.parse(row.frontmatter).status).toBe('draft')
  })

  it('getDocument re-derives on a metadata-only external edit but not on a plain open', () => {
    const id = randomUUID()
    const path = join(vault, 'Get.md')
    writeExternal(
      path,
      [
        `id: ${id}`,
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-01T00:00:00.000Z',
        'status: draft'
      ],
      'body'
    )
    reindexFile(db, path)

    // Plain open: rows unchanged.
    getDocument(db, id)
    expect(props(id).map((r) => `${r.key}=${r.value}`)).toEqual(['status=draft'])

    // External metadata edit, then open -> re-derive.
    writeExternal(
      path,
      [
        `id: ${id}`,
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-03-01T00:00:00.000Z',
        'status: live'
      ],
      'body'
    )
    getDocument(db, id)
    expect(props(id).map((r) => `${r.key}=${r.value}`)).toEqual(['status=live'])
  })
})
