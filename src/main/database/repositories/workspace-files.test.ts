import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../__test__/setup'
import { listWorkspaceFiles, addWorkspaceFile, removeWorkspaceFile } from './workspace-files'
import { createWorkspace } from './workspaces'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

describe('workspace-files repository', () => {
  function makeWorkspace() {
    return createWorkspace(db, { name: 'Test' })
  }

  it('adds and lists workspace files', () => {
    const ws = makeWorkspace()
    const file = addWorkspaceFile(db, {
      workspace_id: ws.id,
      file_path: '/home/user/doc.pdf',
      file_name: 'doc.pdf'
    })

    expect(file.file_path).toBe('/home/user/doc.pdf')
    expect(file.file_name).toBe('doc.pdf')

    const files = listWorkspaceFiles(db, ws.id)
    expect(files.length).toBe(1)
    expect(files[0].file_name).toBe('doc.pdf')
  })

  it('lists files ordered by file_name ASC', () => {
    const ws = makeWorkspace()
    addWorkspaceFile(db, { workspace_id: ws.id, file_path: '/z.txt', file_name: 'z.txt' })
    addWorkspaceFile(db, { workspace_id: ws.id, file_path: '/a.txt', file_name: 'a.txt' })

    const files = listWorkspaceFiles(db, ws.id)
    expect(files[0].file_name).toBe('a.txt')
    expect(files[1].file_name).toBe('z.txt')
  })

  it('enforces unique constraint on (workspace_id, file_path)', () => {
    const ws = makeWorkspace()
    addWorkspaceFile(db, { workspace_id: ws.id, file_path: '/dup.txt', file_name: 'dup.txt' })

    expect(() =>
      addWorkspaceFile(db, { workspace_id: ws.id, file_path: '/dup.txt', file_name: 'dup.txt' })
    ).toThrow()
  })

  it('allows same file_path in different workspaces', () => {
    const ws1 = makeWorkspace()
    const ws2 = createWorkspace(db, { name: 'WS2' })

    addWorkspaceFile(db, { workspace_id: ws1.id, file_path: '/same.txt', file_name: 'same.txt' })
    addWorkspaceFile(db, { workspace_id: ws2.id, file_path: '/same.txt', file_name: 'same.txt' })

    expect(listWorkspaceFiles(db, ws1.id).length).toBe(1)
    expect(listWorkspaceFiles(db, ws2.id).length).toBe(1)
  })

  it('removes a workspace file', () => {
    const ws = makeWorkspace()
    const file = addWorkspaceFile(db, {
      workspace_id: ws.id,
      file_path: '/del.txt',
      file_name: 'del.txt'
    })

    removeWorkspaceFile(db, file.id)

    const files = listWorkspaceFiles(db, ws.id)
    expect(files.length).toBe(0)
  })
})
