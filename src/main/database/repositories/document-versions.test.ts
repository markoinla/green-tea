import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../__test__/setup'
import {
  createVersion,
  listVersions,
  getVersion,
  restoreVersion,
  deleteVersion,
  maybeCreateAutoVersion,
  pruneVersions
} from './document-versions'
import { createDocument, getDocument } from './documents'
import { createWorkspace } from './workspaces'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  const ws = createWorkspace(db, { name: 'Test' })
  const doc = createDocument(db, { title: 'My Doc', workspace_id: ws.id, content: 'initial' })
  return { ws, doc }
}

describe('document-versions repository', () => {
  it('creates and retrieves a version', () => {
    const { doc } = setup()
    const v = createVersion(db, {
      document_id: doc.id,
      title: doc.title,
      content: 'snapshot',
      source: 'manual'
    })

    expect(v.document_id).toBe(doc.id)
    expect(v.source).toBe('manual')
    expect(v.content).toBe('snapshot')

    const fetched = getVersion(db, v.id)
    expect(fetched).toBeDefined()
    expect(fetched!.content).toBe('snapshot')
  })

  it('lists versions ordered by created_at DESC', () => {
    const { doc } = setup()
    const v1 = createVersion(db, { document_id: doc.id, title: 'V1', content: 'a', source: 'manual' })
    const v2 = createVersion(db, { document_id: doc.id, title: 'V2', content: 'b', source: 'manual' })

    // Manually set different created_at to guarantee ordering
    db.prepare('UPDATE document_versions SET created_at = ? WHERE id = ?').run(
      '2025-01-01T00:00:00',
      v1.id
    )
    db.prepare('UPDATE document_versions SET created_at = ? WHERE id = ?').run(
      '2025-01-02T00:00:00',
      v2.id
    )

    const versions = listVersions(db, doc.id)
    expect(versions.length).toBe(2)
    expect(versions[0].title).toBe('V2')
  })

  it('lists versions respects limit', () => {
    const { doc } = setup()
    for (let i = 0; i < 5; i++) {
      createVersion(db, {
        document_id: doc.id,
        title: `V${i}`,
        content: `c${i}`,
        source: 'autosave'
      })
    }

    const versions = listVersions(db, doc.id, 3)
    expect(versions.length).toBe(3)
  })

  it('restoreVersion overwrites document and creates pre-restore snapshot', () => {
    const { doc } = setup()
    const v = createVersion(db, {
      document_id: doc.id,
      title: 'Old Title',
      content: 'old content',
      source: 'manual'
    })

    restoreVersion(db, v.id)

    const restored = getDocument(db, doc.id)!
    expect(restored.title).toBe('Old Title')
    expect(restored.content).toBe('old content')

    // Should have created a 'restore' snapshot of state before restoring
    const versions = listVersions(db, doc.id)
    const restoreSnap = versions.find((v) => v.source === 'restore')
    expect(restoreSnap).toBeDefined()
    expect(restoreSnap!.content).toBe('initial')
  })

  it('deleteVersion removes a version', () => {
    const { doc } = setup()
    const v = createVersion(db, {
      document_id: doc.id,
      title: 'X',
      content: 'y',
      source: 'manual'
    })
    deleteVersion(db, v.id)
    expect(getVersion(db, v.id)).toBeUndefined()
  })

  it('maybeCreateAutoVersion throttles within 5-minute window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))

    const { doc } = setup()

    // First call should create a version
    maybeCreateAutoVersion(db, doc.id, doc.title, 'content1')
    let versions = listVersions(db, doc.id)
    expect(versions.length).toBe(1)

    // Second call within 5 minutes should NOT create a version
    vi.advanceTimersByTime(2 * 60 * 1000) // 2 minutes
    maybeCreateAutoVersion(db, doc.id, doc.title, 'content2')
    versions = listVersions(db, doc.id)
    expect(versions.length).toBe(1)

    // After 5+ minutes, should create another version
    vi.advanceTimersByTime(4 * 60 * 1000) // 4 more minutes (total 6)
    maybeCreateAutoVersion(db, doc.id, doc.title, 'content3')
    versions = listVersions(db, doc.id)
    expect(versions.length).toBe(2)
  })

  it('creates versions with all source types', () => {
    const { doc } = setup()
    const sources = ['autosave', 'agent_patch', 'manual', 'restore']
    for (const source of sources) {
      createVersion(db, { document_id: doc.id, title: doc.title, content: source, source })
    }
    const versions = listVersions(db, doc.id)
    expect(versions.length).toBe(4)
  })
})

describe('pruneVersions', () => {
  it('deletes autosave versions older than 30 days', () => {
    const { doc } = setup()

    // Insert a version dated 45 days ago
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, -1) // strip Z for SQLite
    db.prepare(
      "INSERT INTO document_versions (id, document_id, title, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('old-auto', doc.id, 'Old', 'old', 'autosave', oldDate)

    // Manual version from 45 days ago should survive
    db.prepare(
      "INSERT INTO document_versions (id, document_id, title, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('old-manual', doc.id, 'Old Manual', 'old manual', 'manual', oldDate)

    pruneVersions(db)

    expect(getVersion(db, 'old-auto')).toBeUndefined()
    expect(getVersion(db, 'old-manual')).toBeDefined()
  })

  it('keeps 1 per hour for 1-7 day old autosave versions', () => {
    const { doc } = setup()

    // Insert 3 autosave versions in the same hour, 3 days ago
    const base = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    for (let i = 0; i < 3; i++) {
      const date = new Date(base.getTime() + i * 60 * 1000) // 1 minute apart
      db.prepare(
        "INSERT INTO document_versions (id, document_id, title, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(`hour-${i}`, doc.id, `V${i}`, `c${i}`, 'autosave', date.toISOString().slice(0, -1))
    }

    pruneVersions(db)

    // Newest in the bucket should survive (hour-2 has latest created_at but versions are DESC)
    const remaining = listVersions(db, doc.id)
    const hourVersions = remaining.filter((v) => v.id.startsWith('hour-'))
    expect(hourVersions.length).toBe(1)
  })
})
