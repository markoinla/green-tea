import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { getWorkspaceVaultDir } from './paths'
import { markdownToTiptap } from '../markdown/tiptap-markdown'
import {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  createFolder,
  reindexWorkspace
} from './documents-service'

let db: Database.Database
let base: string
let workspaceId: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-docsvc-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'My Workspace' }).id
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

const content = (md: string): string => JSON.stringify(markdownToTiptap(md))

describe('createDocument', () => {
  it('writes a .md file in the workspace vault and indexes it', () => {
    const doc = createDocument(db, {
      title: 'First Note',
      workspace_id: workspaceId,
      content: content('# First Note\n\nhello')
    })
    const vault = getWorkspaceVaultDir(db, workspaceId)
    const file = join(vault, 'First Note.md')
    expect(existsSync(file)).toBe(true)
    const onDisk = readFileSync(file, 'utf-8')
    expect(onDisk).toContain('# First Note')
    expect(onDisk).toContain(`id: ${doc.id}`)

    const got = getDocument(db, doc.id)
    expect(got?.title).toBe('First Note')
    expect(JSON.parse(got!.content!)).toEqual(markdownToTiptap('# First Note\n\nhello'))
  })

  it('stores a frontmatter title override when the title is not filesystem-legal', () => {
    const doc = createDocument(db, { title: 'Q3: Plan', workspace_id: workspaceId })
    const vault = getWorkspaceVaultDir(db, workspaceId)
    // filename is slugified, but the title round-trips via the override
    const file = readdirSync(vault).find((f) => f.endsWith('.md'))!
    expect(readFileSync(join(vault, file), 'utf-8')).toContain('title: ')
    expect(getDocument(db, doc.id)?.title).toBe('Q3: Plan')
  })
})

describe('updateDocument', () => {
  it('persists content changes to the file and snapshots a version', () => {
    const doc = createDocument(db, {
      title: 'Edit Me',
      workspace_id: workspaceId,
      content: content('v1')
    })
    updateDocument(db, doc.id, { content: content('v2 **changed**') })

    const vault = getWorkspaceVaultDir(db, workspaceId)
    expect(readFileSync(join(vault, 'Edit Me.md'), 'utf-8')).toContain('v2 **changed**')
    expect(JSON.parse(getDocument(db, doc.id)!.content!)).toEqual(
      markdownToTiptap('v2 **changed**')
    )

    const versions = db.prepare('SELECT * FROM document_versions WHERE document_id = ?').all(doc.id)
    expect(versions.length).toBeGreaterThan(0)
  })

  it('does NOT rename the file on a content-only save (no churn)', () => {
    // Force a collision so the filename stem ("Note 2") differs from the title.
    createDocument(db, { title: 'Note', workspace_id: workspaceId })
    const doc = createDocument(db, { title: 'Note', workspace_id: workspaceId })
    const vault = getWorkspaceVaultDir(db, workspaceId)
    expect(existsSync(join(vault, 'Note 2.md'))).toBe(true)

    updateDocument(db, doc.id, { content: content('edited body') })
    // still the same file; no churn into "Note 3.md"
    expect(existsSync(join(vault, 'Note 2.md'))).toBe(true)
    expect(readdirSync(vault).filter((f) => f.endsWith('.md')).sort()).toEqual([
      'Note 2.md',
      'Note.md'
    ])
    expect(readFileSync(join(vault, 'Note 2.md'), 'utf-8')).toContain('edited body')
  })

  it('throws (and prunes) instead of recreating an empty doc when the file vanished', () => {
    const doc = createDocument(db, { title: 'Gone', workspace_id: workspaceId, content: content('important') })
    rmSync(join(getWorkspaceVaultDir(db, workspaceId), 'Gone.md'), { force: true })
    expect(() => updateDocument(db, doc.id, { title: 'Renamed' })).toThrow()
    expect(getDocument(db, doc.id)).toBeUndefined()
  })

  it('renames the file when the title changes', () => {
    const doc = createDocument(db, { title: 'Old Title', workspace_id: workspaceId })
    const vault = getWorkspaceVaultDir(db, workspaceId)
    expect(existsSync(join(vault, 'Old Title.md'))).toBe(true)

    updateDocument(db, doc.id, { title: 'New Title' })
    expect(existsSync(join(vault, 'Old Title.md'))).toBe(false)
    expect(existsSync(join(vault, 'New Title.md'))).toBe(true)
    expect(getDocument(db, doc.id)?.title).toBe('New Title')
  })
})

describe('folders as subdirectories', () => {
  it('writes notes into the folder subdirectory', () => {
    const folder = createFolder(db, { name: 'Projects', workspace_id: workspaceId })
    const doc = createDocument(db, {
      title: 'Plan',
      workspace_id: workspaceId,
      folder_id: folder.id
    })
    const vault = getWorkspaceVaultDir(db, workspaceId)
    expect(existsSync(join(vault, 'Projects', 'Plan.md'))).toBe(true)
    expect(getDocument(db, doc.id)?.folder_id).toBe(folder.id)
  })
})

describe('deleteDocument', () => {
  it('removes the file and the index row', () => {
    const doc = createDocument(db, { title: 'Trash', workspace_id: workspaceId })
    const vault = getWorkspaceVaultDir(db, workspaceId)
    expect(existsSync(join(vault, 'Trash.md'))).toBe(true)
    deleteDocument(db, doc.id)
    expect(existsSync(join(vault, 'Trash.md'))).toBe(false)
    expect(getDocument(db, doc.id)).toBeUndefined()
  })
})

describe('reindex (index is derived from disk)', () => {
  it('rebuilds the index from files after the table is wiped', () => {
    const a = createDocument(db, {
      title: 'Alpha',
      workspace_id: workspaceId,
      content: content('alpha body')
    })
    const folder = createFolder(db, { name: 'Sub', workspace_id: workspaceId })
    const b = createDocument(db, { title: 'Beta', workspace_id: workspaceId, folder_id: folder.id })

    // Simulate a fresh launch: wipe the derived index entirely.
    db.prepare('DELETE FROM documents').run()
    db.prepare('DELETE FROM folders').run()
    expect(listDocuments(db, workspaceId)).toHaveLength(0)

    reindexWorkspace(db, workspaceId)

    const docs = listDocuments(db, workspaceId)
    expect(docs.map((d) => d.title).sort()).toEqual(['Alpha', 'Beta'])
    // ids are recovered from frontmatter, not regenerated
    expect(docs.map((d) => d.id).sort()).toEqual([a.id, b.id].sort())
    // folder membership recovered from the subdirectory
    const beta = docs.find((d) => d.title === 'Beta')!
    expect(beta.folder_id).not.toBeNull()
  })

  it('prunes index rows whose files were deleted externally', () => {
    const doc = createDocument(db, { title: 'Ghost', workspace_id: workspaceId })
    const vault = getWorkspaceVaultDir(db, workspaceId)
    rmSync(join(vault, 'Ghost.md'), { force: true })
    reindexWorkspace(db, workspaceId)
    expect(getDocument(db, doc.id)).toBeUndefined()
    expect(listDocuments(db, workspaceId)).toHaveLength(0)
  })
})
