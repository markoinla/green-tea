import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { createWorkspace } from '../database/repositories/workspaces'
import {
  readWorkspaceDoc,
  writeWorkspaceDoc,
  ensureWorkspaceDocs,
  WORKSPACE_DESCRIPTION_FILE,
  WORKSPACE_MEMORY_FILE
} from './workspace-docs'
import { consumeSelfWrite, hasSelfWrite, clearSelfWriteRegistry } from './self-write'

let dir: string
let db: Database.Database
let workspaceId: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gt-ws-docs-'))
  db = createTestDb()
  // A workspace IS a folder on disk — point it at our temp dir.
  workspaceId = createWorkspace(db, { name: 'Test', path: dir }).id
  clearSelfWriteRegistry()
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  clearSelfWriteRegistry()
})

describe('readWorkspaceDoc', () => {
  it('returns empty string when the file is absent', () => {
    expect(readWorkspaceDoc(db, workspaceId, 'description')).toBe('')
    expect(readWorkspaceDoc(db, workspaceId, 'memory')).toBe('')
  })

  it('returns empty string when the workspace folder is absent', () => {
    rmSync(dir, { recursive: true, force: true })
    expect(readWorkspaceDoc(db, workspaceId, 'description')).toBe('')
  })
})

describe('writeWorkspaceDoc', () => {
  it('round-trips content through write -> read', () => {
    writeWorkspaceDoc(db, workspaceId, 'description', '# Project\n\ncontext')
    writeWorkspaceDoc(db, workspaceId, 'memory', 'remembers things')
    expect(readWorkspaceDoc(db, workspaceId, 'description')).toBe('# Project\n\ncontext')
    expect(readWorkspaceDoc(db, workspaceId, 'memory')).toBe('remembers things')
    expect(existsSync(join(dir, WORKSPACE_DESCRIPTION_FILE))).toBe(true)
    expect(existsSync(join(dir, WORKSPACE_MEMORY_FILE))).toBe(true)
  })

  it('marks a self-write so the watcher would ignore its own bytes', () => {
    const content = 'agent memory'
    writeWorkspaceDoc(db, workspaceId, 'memory', content)
    const path = join(dir, WORKSPACE_MEMORY_FILE)
    expect(hasSelfWrite(path)).toBe(true)
    // The recorded hash matches the bytes on disk → the watcher consumes it.
    expect(consumeSelfWrite(path, content)).toBe(true)
  })

  it('overwrites existing content wholesale', () => {
    writeWorkspaceDoc(db, workspaceId, 'memory', 'first')
    writeWorkspaceDoc(db, workspaceId, 'memory', 'second')
    expect(readWorkspaceDoc(db, workspaceId, 'memory')).toBe('second')
  })
})

describe('ensureWorkspaceDocs', () => {
  it('creates both docs EMPTY when missing', () => {
    ensureWorkspaceDocs(db, workspaceId)
    expect(readFileSync(join(dir, WORKSPACE_DESCRIPTION_FILE), 'utf-8')).toBe('')
    expect(readFileSync(join(dir, WORKSPACE_MEMORY_FILE), 'utf-8')).toBe('')
  })

  it('marks self-writes for the empty files it creates', () => {
    ensureWorkspaceDocs(db, workspaceId)
    expect(consumeSelfWrite(join(dir, WORKSPACE_DESCRIPTION_FILE), '')).toBe(true)
    expect(consumeSelfWrite(join(dir, WORKSPACE_MEMORY_FILE), '')).toBe(true)
  })

  it('does NOT overwrite existing content', () => {
    writeFileSync(join(dir, WORKSPACE_DESCRIPTION_FILE), 'user wrote this')
    writeWorkspaceDoc(db, workspaceId, 'memory', 'agent wrote this')
    ensureWorkspaceDocs(db, workspaceId)
    expect(readFileSync(join(dir, WORKSPACE_DESCRIPTION_FILE), 'utf-8')).toBe('user wrote this')
    expect(readFileSync(join(dir, WORKSPACE_MEMORY_FILE), 'utf-8')).toBe('agent wrote this')
  })

  it('is a NO-OP when the workspace folder does not exist', () => {
    rmSync(dir, { recursive: true, force: true })
    ensureWorkspaceDocs(db, workspaceId)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(join(dir, WORKSPACE_DESCRIPTION_FILE))).toBe(false)
    expect(existsSync(join(dir, WORKSPACE_MEMORY_FILE))).toBe(false)
  })
})
