import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../__test__/setup'
import { listFolders, getFolder, createFolder, updateFolder, deleteFolder } from './folders'
import { createWorkspace } from './workspaces'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

describe('folders repository', () => {
  it('creates and retrieves a folder', () => {
    const ws = createWorkspace(db, { name: 'Test' })
    const folder = createFolder(db, { name: 'My Folder', workspace_id: ws.id })
    expect(folder.name).toBe('My Folder')
    expect(folder.workspace_id).toBe(ws.id)

    const fetched = getFolder(db, folder.id)
    expect(fetched).toBeDefined()
    expect(fetched!.name).toBe('My Folder')
  })

  it('lists folders ordered by name ASC', () => {
    const ws = createWorkspace(db, { name: 'Test' })
    createFolder(db, { name: 'Zebra', workspace_id: ws.id })
    createFolder(db, { name: 'Apple', workspace_id: ws.id })

    const folders = listFolders(db, ws.id)
    expect(folders.length).toBe(2)
    expect(folders[0].name).toBe('Apple')
    expect(folders[1].name).toBe('Zebra')
  })

  it('filters by workspace_id', () => {
    const ws1 = createWorkspace(db, { name: 'WS1' })
    const ws2 = createWorkspace(db, { name: 'WS2' })
    createFolder(db, { name: 'F1', workspace_id: ws1.id })
    createFolder(db, { name: 'F2', workspace_id: ws2.id })

    const folders = listFolders(db, ws1.id)
    expect(folders.length).toBe(1)
    expect(folders[0].name).toBe('F1')
  })

  it('lists all folders without workspace filter', () => {
    const ws = createWorkspace(db, { name: 'Test' })
    createFolder(db, { name: 'A', workspace_id: ws.id })
    createFolder(db, { name: 'B', workspace_id: ws.id })

    const all = listFolders(db)
    expect(all.length).toBeGreaterThanOrEqual(2)
  })

  it('updates folder name and collapsed state', () => {
    const ws = createWorkspace(db, { name: 'Test' })
    const folder = createFolder(db, { name: 'Old', workspace_id: ws.id })

    const updated = updateFolder(db, folder.id, { name: 'New', collapsed: 1 })
    expect(updated.name).toBe('New')
    expect(updated.collapsed).toBe(1)
  })

  it('throws when updating nonexistent folder', () => {
    expect(() => updateFolder(db, 'nope', { name: 'X' })).toThrow('Folder not found')
  })

  it('deletes a folder', () => {
    const ws = createWorkspace(db, { name: 'Test' })
    const folder = createFolder(db, { name: 'Del', workspace_id: ws.id })
    deleteFolder(db, folder.id)
    expect(getFolder(db, folder.id)).toBeUndefined()
  })
})
