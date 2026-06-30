import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../../database/__test__/setup'
import { setSetting } from '../../database/repositories/settings'
import { createWorkspace } from '../../database/repositories/workspaces'
import { createDocument, getDocument } from '../../vault/documents-service'
import { commitWorkspaceAll } from '../../git/workspace-git'
import { __resetRepoQueuesForTest } from '../../git/git-service'
import { createNotesGitTools } from './notes-git-tools'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

let db: Database.Database
let base: string
let workspaceId: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-notesgit-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'WS' }).id
  __resetRepoQueuesForTest()
})

afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

/** Run a tool by name and return its concatenated text content. */
async function run(
  tools: ToolDefinition[],
  name: string,
  params: Record<string, unknown>
): Promise<string> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool not found: ${name}`)
  // These read-only tools ignore signal/onUpdate/ctx; pass undefined for them.
  const res = await tool.execute('call-1', params, undefined, undefined, undefined as never)
  return res.content.map((c) => ('text' in c ? c.text : '')).join('')
}

/**
 * Rewrite a note's BODY while preserving its existing frontmatter (and thus its
 * stable `id`). Real notes always carry frontmatter; writing raw bodyless bytes
 * makes getDocument re-key the file as an externally-created note, which would move
 * its path out from under the git history. This keeps the path stable across
 * revisions so the per-note log/diff/show stay attributable to one note.
 */
function setBody(file: string, body: string): void {
  const cur = readFileSync(file, 'utf-8')
  const m = cur.match(/^---\n[\s\S]*?\n---\n/)
  writeFileSync(file, (m ? m[0] : '') + body, 'utf-8')
}

describe('read-only agent git tools', () => {
  it('exposes exactly the three read-only tools and no mutating git tool', () => {
    const tools = createNotesGitTools(db, workspaceId)
    expect(tools.map((t) => t.name).sort()).toEqual([
      'notes_git_diff',
      'notes_git_log',
      'notes_git_show'
    ])
  })

  it('logs commit history for a note and for the whole vault, newest first', async () => {
    const doc = createDocument(db, { title: 'History', workspace_id: workspaceId })
    const file = getDocument(db, doc.id)!.file_path!
    setBody(file, 'first state\n')
    await commitWorkspaceAll(db, workspaceId, 'v1')
    setBody(file, 'second state\n')
    await commitWorkspaceAll(db, workspaceId, 'v2')

    const tools = createNotesGitTools(db, workspaceId)

    const perNote = await run(tools, 'notes_git_log', { document_id: doc.id })
    const lines = perNote.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('v2') // newest first
    expect(lines[1]).toContain('v1')

    const vault = await run(tools, 'notes_git_log', {})
    expect(vault).toContain('v2')
    expect(vault).toContain('v1')
  })

  it('shows a note as it was at a past commit', async () => {
    const doc = createDocument(db, { title: 'Show', workspace_id: workspaceId })
    const file = getDocument(db, doc.id)!.file_path!
    setBody(file, 'original bytes\n')
    await commitWorkspaceAll(db, workspaceId, 'v1')
    setBody(file, 'changed bytes\n')
    await commitWorkspaceAll(db, workspaceId, 'v2')

    const tools = createNotesGitTools(db, workspaceId)
    const head = await run(tools, 'notes_git_show', { document_id: doc.id, ref: 'HEAD' })
    expect(head).toContain('changed bytes')
    expect(readFileSync(file, 'utf-8')).toContain('changed bytes')
  })

  it('diffs a note against the working tree and between two commits', async () => {
    const doc = createDocument(db, { title: 'Diff', workspace_id: workspaceId })
    const file = getDocument(db, doc.id)!.file_path!
    setBody(file, 'alpha\nbeta\n')
    const tools = createNotesGitTools(db, workspaceId)

    // Commit v1, then change on disk WITHOUT committing → diff(from=HEAD) vs worktree.
    await commitWorkspaceAll(db, workspaceId, 'v1')
    setBody(file, 'alpha\nBETA\n')
    const vsWorktree = await run(tools, 'notes_git_diff', { document_id: doc.id, from_ref: 'HEAD' })
    expect(vsWorktree).toContain('-beta')
    expect(vsWorktree).toContain('+BETA')

    // Commit v2, then a two-ref diff that ignores any later worktree drift.
    await commitWorkspaceAll(db, workspaceId, 'v2')
    const log = await run(tools, 'notes_git_log', { document_id: doc.id })
    const [newOid, oldOid] = log
      .trim()
      .split('\n')
      .map((l) => l.split(/\s+/)[0])
    setBody(file, 'alpha\nBETA\ngamma\n')
    const between = await run(tools, 'notes_git_diff', {
      document_id: doc.id,
      from_ref: oldOid,
      to_ref: newOid
    })
    expect(between).toContain('-beta')
    expect(between).toContain('+BETA')
    expect(between).not.toContain('gamma')
  })

  it('reports a clean message when there is no history', async () => {
    const doc = createDocument(db, { title: 'Empty', workspace_id: workspaceId })
    const tools = createNotesGitTools(db, workspaceId)
    const out = await run(tools, 'notes_git_log', { document_id: doc.id })
    expect(out.toLowerCase()).toContain('no commits')
  })

  it('errors a whole-vault log without workspace context', async () => {
    const tools = createNotesGitTools(db, undefined)
    const out = await run(tools, 'notes_git_log', {})
    expect(out).toContain('No workspace context')
  })
})
