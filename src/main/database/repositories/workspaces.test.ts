import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../__test__/setup'
import {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace
} from './workspaces'
import { createDocument } from './documents'
import { createFolder } from './folders'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

describe('workspaces repository', () => {
  it('creates and retrieves a workspace', () => {
    const ws = createWorkspace(db, { name: 'My Workspace' })
    expect(ws.name).toBe('My Workspace')
    expect(ws.description).toBe('')
    expect(ws.memory).toBe('')

    const fetched = getWorkspace(db, ws.id)
    expect(fetched).toBeDefined()
    expect(fetched!.name).toBe('My Workspace')
  })

  it('lists workspaces ordered by created_at ASC', () => {
    // Note: migration creates a 'Default' workspace
    const existing = listWorkspaces(db)
    const ws = createWorkspace(db, { name: 'Second' })

    const all = listWorkspaces(db)
    expect(all.length).toBe(existing.length + 1)
    expect(all[all.length - 1].id).toBe(ws.id)
  })

  it('updates workspace fields', () => {
    const ws = createWorkspace(db, { name: 'Old' })
    const updated = updateWorkspace(db, ws.id, {
      name: 'New',
      description: 'Desc',
      memory: 'Some memory'
    })
    expect(updated.name).toBe('New')
    expect(updated.description).toBe('Desc')
    expect(updated.memory).toBe('Some memory')
  })

  it('throws when updating nonexistent workspace', () => {
    expect(() => updateWorkspace(db, 'nope', { name: 'X' })).toThrow('Workspace not found')
  })

  it('deleteWorkspace prevents deleting the last workspace', () => {
    // Delete all but one
    const all = listWorkspaces(db)
    for (let i = 1; i < all.length; i++) {
      deleteWorkspace(db, all[i].id)
    }

    expect(() => deleteWorkspace(db, all[0].id)).toThrow('Cannot delete the last workspace')
  })

  it('deleteWorkspace cascades documents and folders', () => {
    const ws1 = createWorkspace(db, { name: 'WS1' })
    createDocument(db, { title: 'Doc in WS1', workspace_id: ws1.id })
    createFolder(db, { name: 'Folder in WS1', workspace_id: ws1.id })

    deleteWorkspace(db, ws1.id)

    expect(getWorkspace(db, ws1.id)).toBeUndefined()
    const docs = db.prepare('SELECT * FROM documents WHERE workspace_id = ?').all(ws1.id)
    expect(docs.length).toBe(0)
    const folders = db.prepare('SELECT * FROM folders WHERE workspace_id = ?').all(ws1.id)
    expect(folders.length).toBe(0)
  })
})
