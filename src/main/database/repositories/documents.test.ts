import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../__test__/setup'
import {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  searchDocuments,
  deleteDocument
} from './documents'
import { createWorkspace } from './workspaces'
import { createAgentLog } from './agent-logs'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

describe('documents repository', () => {
  function makeWorkspace(name = 'Test') {
    return createWorkspace(db, { name })
  }

  it('creates and retrieves a document', () => {
    const ws = makeWorkspace()
    const doc = createDocument(db, { title: 'Hello', workspace_id: ws.id })
    expect(doc.title).toBe('Hello')
    expect(doc.workspace_id).toBe(ws.id)

    const fetched = getDocument(db, doc.id)
    expect(fetched).toBeDefined()
    expect(fetched!.title).toBe('Hello')
  })

  it('lists documents ordered by updated_at DESC', () => {
    const ws = makeWorkspace()
    const d1 = createDocument(db, { title: 'A', workspace_id: ws.id })
    const d2 = createDocument(db, { title: 'B', workspace_id: ws.id })
    updateDocument(db, d1.id, { title: 'A updated' })

    const docs = listDocuments(db)
    expect(docs.length).toBe(2)
    expect(docs[0].id).toBe(d1.id) // d1 updated more recently
    expect(docs[1].id).toBe(d2.id)
  })

  it('filters by workspace_id', () => {
    const ws1 = makeWorkspace('WS1')
    const ws2 = makeWorkspace('WS2')
    createDocument(db, { title: 'In WS1', workspace_id: ws1.id })
    createDocument(db, { title: 'In WS2', workspace_id: ws2.id })

    const docs = listDocuments(db, ws1.id)
    expect(docs.length).toBe(1)
    expect(docs[0].title).toBe('In WS1')
  })

  it('updates a document', () => {
    const ws = makeWorkspace()
    const doc = createDocument(db, { title: 'Old', workspace_id: ws.id })
    const updated = updateDocument(db, doc.id, { title: 'New' })
    expect(updated.title).toBe('New')
  })

  it('throws when updating nonexistent document', () => {
    expect(() => updateDocument(db, 'nope', { title: 'X' })).toThrow('Document not found')
  })

  it('searchDocuments finds by partial title match', () => {
    const ws = makeWorkspace()
    createDocument(db, { title: 'Meeting Notes', workspace_id: ws.id })
    createDocument(db, { title: 'Shopping List', workspace_id: ws.id })

    const results = searchDocuments(db, 'meet')
    expect(results.length).toBe(1)
    expect(results[0].title).toBe('Meeting Notes')
    expect(results[0].workspace_name).toBe('Test')
  })

  it('deleteDocument removes the document and its agent_logs', () => {
    const ws = makeWorkspace()
    const doc = createDocument(db, { title: 'To Delete', workspace_id: ws.id })
    createAgentLog(db, {
      document_id: doc.id,
      agent_name: 'test',
      action_type: 'edit'
    })

    deleteDocument(db, doc.id)

    expect(getDocument(db, doc.id)).toBeUndefined()
    const logs = db.prepare('SELECT * FROM agent_logs WHERE document_id = ?').all(doc.id)
    expect(logs.length).toBe(0)
  })

  it('updateDocument triggers auto-version creation when content changes', () => {
    const ws = makeWorkspace()
    const doc = createDocument(db, { title: 'Versioned', workspace_id: ws.id, content: 'v1' })
    updateDocument(db, doc.id, { content: 'v2' })

    const versions = db
      .prepare('SELECT * FROM document_versions WHERE document_id = ?')
      .all(doc.id)
    expect(versions.length).toBeGreaterThanOrEqual(1)
  })
})
