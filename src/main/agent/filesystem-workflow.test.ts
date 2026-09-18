import { randomUUID } from 'crypto'
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { createEditTool, createWriteTool } from '@earendil-works/pi-coding-agent'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { getAgentWorkDir, getWorkspaceDir } from './paths'
import { listDocuments, getDocument, listByProperty } from '../vault/documents-service'
import { startVaultWatcher, stopVaultWatcher } from '../vault/vault-watcher'
import { createNotesTools } from './tools/notes-tools'

vi.mock('../google', () => ({ hasGoogleService: () => false }))
vi.mock('../microsoft', () => ({ hasMicrosoftService: () => false }))

let db: Database.Database
let base: string
let workspaceId: string
let workspace: string
let scratch: string
const send = vi.fn()

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-file-workflow-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'File Workspace' }).id
  workspace = getWorkspaceDir(db, workspaceId)
  scratch = getAgentWorkDir(db, workspaceId)
  mkdirSync(scratch, { recursive: true })
  send.mockClear()
  startVaultWatcher(db, {
    isDestroyed: () => false,
    webContents: { send }
  } as unknown as BrowserWindow)
})

afterEach(() => {
  stopVaultWatcher()
  db.close()
  rmSync(base, { recursive: true, force: true })
})

describe('generic file tools and the live vault', () => {
  it('creates, edits metadata and content, and moves a note without changing identity', async () => {
    const id = randomUUID()
    const path = join(workspace, 'Plan.md')
    await createWriteTool(scratch).execute('create', {
      path,
      content: `---\nid: ${id}\nstatus: draft\n---\n\nOriginal plan\n`
    })
    await vi.waitFor(() => expect(getDocument(db, id)?.title).toBe('Plan'))

    await createEditTool(scratch).execute('edit', {
      path,
      edits: [
        { oldText: 'status: draft', newText: 'status: ready' },
        { oldText: 'Original plan', newText: 'Updated plan' }
      ]
    })
    await vi.waitFor(() => {
      expect(getDocument(db, id)?.content).toContain('Updated plan')
      expect(listByProperty(db, workspaceId, 'status', 'ready').map((d) => d.id)).toContain(id)
    })
    expect(send).toHaveBeenCalledWith('documents:content-changed', { id })

    const folder = join(workspace, 'Projects')
    mkdirSync(folder)
    const moved = join(folder, 'Renamed.md')
    renameSync(path, moved)
    await vi.waitFor(() => {
      expect(getDocument(db, id)?.file_path).toBe(moved)
      expect(getDocument(db, id)?.title).toBe('Renamed')
      expect(listDocuments(db, workspaceId)).toHaveLength(1)
    })
    expect(readFileSync(moved, 'utf8')).toContain(`id: ${id}`)

    const tools = createNotesTools(db, {} as BrowserWindow, workspaceId)
    expect(tools.filter((tool) => tool.name.startsWith('notes_')).map((tool) => tool.name)).toEqual(
      ['notes_git_log', 'notes_git_show', 'notes_git_diff']
    )
    const ls = tools.find((tool) => tool.name === 'ls')!
    const result = await ls.execute('list', {}, undefined, undefined, {} as never)
    expect(JSON.stringify(result.content)).toContain('Projects')
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['find', 'grep']))
  })
})
