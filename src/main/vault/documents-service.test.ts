import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'fs'

// The service moves deleted notes to the OS trash via Electron's shell.trashItem,
// which isn't available outside the Electron runtime. Mock it to remove the path
// so deletion behaviour stays observable in the node test environment.
vi.mock('electron', () => ({
  shell: {
    trashItem: vi.fn(async (p: string) => {
      const { rmSync: rm } = await import('fs')
      rm(p, { recursive: true, force: true })
    })
  }
}))
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { getWorkspaceVaultDir } from './paths'
import { markdownToTiptap } from '../markdown/tiptap-markdown'
import { parseFrontmatter, stringifyFrontmatter } from '../markdown/frontmatter'
import {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  createFolder,
  renameFolder,
  reindexWorkspace
} from './documents-service'
import { listFolders } from '../database/repositories/folders'

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
  it('persists content changes to the file', () => {
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

  it('moves a folder (and its notes) on disk when nested into another folder', () => {
    const alpha = createFolder(db, { name: 'Alpha', workspace_id: workspaceId })
    createDocument(db, { title: 'Plan', workspace_id: workspaceId, folder_id: alpha.id })
    const vault = getWorkspaceVaultDir(db, workspaceId)
    expect(existsSync(join(vault, 'Alpha', 'Plan.md'))).toBe(true)

    // Nest Alpha under a (new) parent path — the drag-to-folder gesture.
    renameFolder(db, alpha.id, 'Projects/Alpha')

    expect(existsSync(join(vault, 'Alpha'))).toBe(false)
    expect(existsSync(join(vault, 'Projects', 'Alpha', 'Plan.md'))).toBe(true)
    expect(listFolders(db, workspaceId).map((f) => f.name)).toContain('Projects/Alpha')
  })

  it('keeps an EMPTY subfolder after its parent is moved', () => {
    const alpha = createFolder(db, { name: 'Alpha', workspace_id: workspaceId })
    createDocument(db, { title: 'Plan', workspace_id: workspaceId, folder_id: alpha.id })
    // Alpha/Sub holds no notes — only the indexer's directory walk can surface it.
    createFolder(db, { name: 'Alpha/Sub', workspace_id: workspaceId })
    const vault = getWorkspaceVaultDir(db, workspaceId)
    expect(existsSync(join(vault, 'Alpha', 'Sub'))).toBe(true)

    renameFolder(db, alpha.id, 'Projects/Alpha')

    // The empty subdirectory rode along on disk and still has an index row.
    expect(existsSync(join(vault, 'Projects', 'Alpha', 'Sub'))).toBe(true)
    expect(listFolders(db, workspaceId).map((f) => f.name)).toContain('Projects/Alpha/Sub')
  })
})

describe('deleteDocument', () => {
  it('moves the file to trash and removes the index row', async () => {
    const doc = createDocument(db, { title: 'Trash', workspace_id: workspaceId })
    const vault = getWorkspaceVaultDir(db, workspaceId)
    expect(existsSync(join(vault, 'Trash.md'))).toBe(true)
    await deleteDocument(db, doc.id)
    expect(existsSync(join(vault, 'Trash.md'))).toBe(false)
    expect(getDocument(db, doc.id)).toBeUndefined()
  })
})

describe('frontmatter preservation (C1: writes must not clobber user properties)', () => {
  // Seed arbitrary user properties into a note's frontmatter on disk, the way an
  // external editor (Obsidian) or a power user would. Returns the file path.
  // Inject arbitrary user props into the EXISTING frontmatter, preserving the
  // body bytes the service already wrote (so a same-content round-trip stays
  // byte-stable apart from our managed keys).
  const seedUserProps = (
    relPath: string,
    props: Record<string, unknown>
  ): { file: string; before: string } => {
    const vault = getWorkspaceVaultDir(db, workspaceId)
    const file = join(vault, relPath)
    const raw = readFileSync(file, 'utf-8')
    const { data, body } = parseFrontmatter(raw)
    const merged = { ...data, ...props }
    const next = stringifyFrontmatter(merged, body)
    writeFileSync(file, next, 'utf-8')
    // re-read through the service so the index timestamp/content mirror is fresh
    getDocument(db, idForFile)
    return { file, before: next }
  }

  let idForFile = ''

  const fmOf = (file: string): Record<string, unknown> =>
    parseFrontmatter(readFileSync(file, 'utf-8')).data

  it('(a) body autosave preserves arbitrary user properties on disk', () => {
    const doc = createDocument(db, {
      title: 'Autosave',
      workspace_id: workspaceId,
      content: content('original body')
    })
    idForFile = doc.id
    const { file } = seedUserProps('Autosave.md', {
      tags: ['alpha', 'beta'],
      status: 'draft',
      priority: 3,
      pinned: true
    })

    // content-only update (the autosave path)
    updateDocument(db, doc.id, { content: content('edited body') })

    const fm = fmOf(file)
    expect(fm.tags).toEqual(['alpha', 'beta'])
    expect(fm.status).toBe('draft')
    expect(fm.priority).toBe(3)
    expect(fm.pinned).toBe(true)
    expect(readFileSync(file, 'utf-8')).toContain('edited body')
  })

  it('(b) a simulated agent body patch preserves user properties', () => {
    const doc = createDocument(db, {
      title: 'Patched',
      workspace_id: workspaceId,
      content: content('the quick brown fox')
    })
    idForFile = doc.id
    const { file } = seedUserProps('Patched.md', { author: 'jane', reviewed: false })

    // An agent body patch applies through updateDocument with new content
    // (session.applyEdit -> updateDocument(db, id, { title, content })).
    updateDocument(db, doc.id, {
      title: 'Patched',
      content: content('the quick red fox')
    })

    const fm = fmOf(file)
    expect(fm.author).toBe('jane')
    expect(fm.reviewed).toBe(false)
    expect(readFileSync(file, 'utf-8')).toContain('the quick red fox')
  })

  it('(c) folder move (folder_id change) preserves user properties', () => {
    const doc = createDocument(db, {
      title: 'Movable',
      workspace_id: workspaceId,
      content: content('body')
    })
    idForFile = doc.id
    seedUserProps('Movable.md', { tags: ['keep', 'me'], rating: 5 })

    const folder = createFolder(db, { name: 'Archive', workspace_id: workspaceId })
    updateDocument(db, doc.id, { folder_id: folder.id })

    const vault = getWorkspaceVaultDir(db, workspaceId)
    const moved = join(vault, 'Archive', 'Movable.md')
    expect(existsSync(moved)).toBe(true)
    const fm = fmOf(moved)
    expect(fm.tags).toEqual(['keep', 'me'])
    expect(fm.rating).toBe(5)
  })

  it('(d) round-trip of a note with arbitrary keys is byte-stable except updated', () => {
    const doc = createDocument(db, {
      title: 'Roundtrip',
      workspace_id: workspaceId,
      content: content('stable content')
    })
    idForFile = doc.id
    const { file } = seedUserProps('Roundtrip.md', {
      tags: ['x', 'y', 'z'],
      status: 'published',
      nested: { a: 1, b: 'two' },
      count: 42
    })
    const before = readFileSync(file, 'utf-8')

    // A no-op-ish content save: same body, only `updated` should differ.
    updateDocument(db, doc.id, { content: content('stable content') })
    const after = readFileSync(file, 'utf-8')

    const normalize = (s: string): string => s.replace(/^updated: .*$/m, 'updated: <ts>')
    expect(normalize(after)).toBe(normalize(before))

    // And confirm all user keys are intact and equal.
    const fmBefore = parseFrontmatter(before).data
    const fmAfter = parseFrontmatter(after).data
    delete fmBefore.updated
    delete fmAfter.updated
    expect(fmAfter).toEqual(fmBefore)
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
