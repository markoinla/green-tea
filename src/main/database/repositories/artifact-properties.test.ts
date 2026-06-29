import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../__test__/setup'
import { createWorkspace } from './workspaces'
import {
  setArtifactProperties,
  getArtifactProperties,
  deleteArtifactProperties,
  hasArtifactProperties
} from './artifact-properties'
import { resolvePropertyType } from '../../vault/documents-service'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

/** Insert a bare artifact `documents` row (path-based identity) for the tests. */
function makeArtifact(workspaceId: string, path: string, id = 'art-' + path): string {
  db.prepare(
    `INSERT INTO documents (id, title, content, workspace_id, file_path, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, datetime('now'), datetime('now'))`
  ).run(id, path, workspaceId, path)
  return id
}

describe('artifact-properties repository', () => {
  function typeFor(workspaceId: string) {
    return (key: string, inferred: ReturnType<typeof resolvePropertyType>) =>
      resolvePropertyType(db, workspaceId, key, inferred)
  }

  it('sets and gets scalar properties', () => {
    const ws = createWorkspace(db, { name: 'WS' })
    const id = makeArtifact(ws.id, '/v/chart.png')

    setArtifactProperties(db, id, { author: 'Marko', priority: 2 }, typeFor(ws.id))

    const rows = getArtifactProperties(db, id)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.author.value).toBe('Marko')
    expect(byKey.author.value_type).toBe('text')
    expect(byKey.priority.value).toBe('2')
    expect(byKey.priority.value_type).toBe('number')
    expect(byKey.priority.conforms).toBe(1)
  })

  it('infers list/tags/date/checkbox types', () => {
    const ws = createWorkspace(db, { name: 'WS' })
    const id = makeArtifact(ws.id, '/v/report.pdf')

    setArtifactProperties(
      db,
      id,
      { tags: ['#research', 'AI'], due: '2026-01-15', done: true },
      typeFor(ws.id)
    )

    const rows = getArtifactProperties(db, id)
    const tags = rows.filter((r) => r.key === 'tags')
    expect(tags.length).toBe(2)
    // Leading `#` stripped; an array value infers as `list` (the `tags` registry
    // type is only applied when the user sets it), matching the notes path.
    expect(tags.map((r) => r.value).sort()).toEqual(['AI', 'research'])
    expect(tags.every((r) => r.value_type === 'list')).toBe(true)

    const due = rows.find((r) => r.key === 'due')!
    expect(due.value_type).toBe('date')
    expect(due.conforms).toBe(1)

    const done = rows.find((r) => r.key === 'done')!
    expect(done.value_type).toBe('checkbox')
    expect(done.value).toBe('true')
  })

  it('replaces all rows on each set (delete + reinsert)', () => {
    const ws = createWorkspace(db, { name: 'WS' })
    const id = makeArtifact(ws.id, '/v/a.csv')

    setArtifactProperties(db, id, { a: '1', b: '2' }, typeFor(ws.id))
    setArtifactProperties(db, id, { a: '9' }, typeFor(ws.id))

    const rows = getArtifactProperties(db, id)
    expect(rows.length).toBe(1)
    expect(rows[0].key).toBe('a')
    expect(rows[0].value).toBe('9')
  })

  it('rejects RESERVED_KEYS (no rows derived for them)', () => {
    const ws = createWorkspace(db, { name: 'WS' })
    const id = makeArtifact(ws.id, '/v/x.html')

    setArtifactProperties(
      db,
      id,
      { id: 'nope', title: 'nope', created: 'nope', updated: 'nope', keep: 'yes' },
      typeFor(ws.id)
    )

    const rows = getArtifactProperties(db, id)
    expect(rows.map((r) => r.key)).toEqual(['keep'])
  })

  it('seeds the shared property_types registry', () => {
    const ws = createWorkspace(db, { name: 'WS' })
    const id = makeArtifact(ws.id, '/v/y.png')

    setArtifactProperties(db, id, { priority: 5 }, typeFor(ws.id))

    const reg = db
      .prepare('SELECT key, type, user_set FROM property_types WHERE workspace_id = ? AND key = ?')
      .get(ws.id, 'priority') as { key: string; type: string; user_set: number }
    expect(reg.type).toBe('number')
    expect(reg.user_set).toBe(0)
  })

  it('reports presence and deletes', () => {
    const ws = createWorkspace(db, { name: 'WS' })
    const id = makeArtifact(ws.id, '/v/z.png')

    expect(hasArtifactProperties(db, id)).toBe(false)
    setArtifactProperties(db, id, { k: 'v' }, typeFor(ws.id))
    expect(hasArtifactProperties(db, id)).toBe(true)

    deleteArtifactProperties(db, id)
    expect(hasArtifactProperties(db, id)).toBe(false)
    expect(getArtifactProperties(db, id).length).toBe(0)
  })

  it('cascades rows when the document is deleted', () => {
    const ws = createWorkspace(db, { name: 'WS' })
    const id = makeArtifact(ws.id, '/v/c.png')
    setArtifactProperties(db, id, { k: 'v' }, typeFor(ws.id))

    db.prepare('DELETE FROM documents WHERE id = ?').run(id)
    expect(getArtifactProperties(db, id).length).toBe(0)
  })
})
