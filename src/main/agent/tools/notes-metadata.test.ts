import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../../database/__test__/setup'
import { setSetting } from '../../database/repositories/settings'
import { createWorkspace } from '../../database/repositories/workspaces'
import {
  createDocument,
  getDocument,
  updateFrontmatter,
  updateDocument
} from '../../vault/documents-service'
import { markdownToTiptap, tiptapToMarkdown, type TTDoc } from '../../markdown/tiptap-markdown'
import { applyMetadataEdit, approveMetadataEdit } from '../session'
import { notesProposeMetadata } from './notes-write'
import type { AgentLog } from '../../database/types'

let db: Database.Database
let base: string
let workspaceId: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-notesmeta-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'WS' }).id
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

function newDoc(title: string): string {
  return createDocument(db, { title, workspace_id: workspaceId }).id
}

describe('notesProposeMetadata — batched proposal', () => {
  it('stores one log carrying the JSON payload across all notes (pending)', () => {
    const a = newDoc('A')
    const b = newDoc('B')

    const res = notesProposeMetadata(
      db,
      {
        edits: [
          { document_id: a, changedKeys: { tags: ['research'] } },
          { document_id: b, changedKeys: { tags: ['research'] } }
        ]
      },
      false,
      workspaceId
    )
    expect(res.error).toBeUndefined()
    const log = res.log as AgentLog
    expect(log.action_type).toBe('propose_metadata')
    const payload = JSON.parse(log.metadata_payload!) as Array<{ document_id: string }>
    expect(payload.map((p) => p.document_id)).toEqual([a, b])
    // Nothing applied yet.
    expect(getDocument(db, a)!.frontmatter?.tags).toBeUndefined()
  })

  it('applies the batch on approve, writing each note', () => {
    const a = newDoc('A')
    const b = newDoc('B')
    const res = notesProposeMetadata(
      db,
      {
        edits: [
          { document_id: a, changedKeys: { status: 'done' } },
          { document_id: b, changedKeys: { status: 'done' } }
        ]
      },
      false,
      workspaceId
    )
    const { documentIds } = approveMetadataEdit(db, (res.log as AgentLog).id)
    expect(new Set(documentIds)).toEqual(new Set([a, b]))
    expect(getDocument(db, a)!.frontmatter?.status).toBe('done')
    expect(getDocument(db, b)!.frontmatter?.status).toBe('done')

    const log = db
      .prepare('SELECT status FROM agent_logs WHERE id = ?')
      .get((res.log as AgentLog).id) as {
      status: string
    }
    expect(log.status).toBe('applied')
  })

  it('auto-approves when requested', () => {
    const a = newDoc('A')
    const res = notesProposeMetadata(
      db,
      { edits: [{ document_id: a, changedKeys: { priority: 1 } }] },
      true,
      workspaceId
    )
    expect(res.error).toBeUndefined()
    expect(getDocument(db, a)!.frontmatter?.priority).toBe(1)
  })
})

describe('reserved keys are rejected from agent metadata writes', () => {
  it('strips reserved keys at proposal time and surfaces them to the model', () => {
    const a = newDoc('A')
    const res = notesProposeMetadata(
      db,
      { edits: [{ document_id: a, changedKeys: { id: 'hacked', status: 'draft' } }] },
      false,
      workspaceId
    )
    expect(res.error).toBeUndefined()
    expect(res.content).toContain('Reserved keys were ignored')
    expect(res.content).toContain('id')
    const payload = JSON.parse((res.log as AgentLog).metadata_payload!) as Array<{
      changedKeys: Record<string, unknown>
    }>
    expect(payload[0].changedKeys).toEqual({ status: 'draft' })
  })

  it('errors when only reserved keys are provided (nothing to apply)', () => {
    const a = newDoc('A')
    const res = notesProposeMetadata(
      db,
      { edits: [{ document_id: a, changedKeys: { id: 'x', title: 'y' } }] },
      false,
      workspaceId
    )
    expect(res.error).toBeTruthy()
    expect(res.error).toContain('reserved keys')
  })

  it('the chokepoint enforces it again at apply time even if a payload sneaks one in', () => {
    const a = newDoc('A')
    // Forge a log whose payload contains a reserved key (bypassing the proposal guard).
    const id = 'forged-log'
    db.prepare(
      "INSERT INTO agent_logs (id, document_id, agent_name, action_type, metadata_payload) VALUES (?, ?, 'notes-assistant', 'propose_metadata', ?)"
    ).run(id, a, JSON.stringify([{ document_id: a, changedKeys: { id: 'evil', status: 'ok' } }]))

    const { rejectedKeys } = applyMetadataEdit(db, id)
    expect(rejectedKeys).toContain('id')
    // The reserved id was NOT changed; the legitimate key WAS applied.
    expect(getDocument(db, a)!.id).toBe(a)
    expect(getDocument(db, a)!.frontmatter?.status).toBe('ok')
  })
})

describe('Phase 0 regression — agent body patch preserves properties (agent path)', () => {
  it('a body edit does not drop frontmatter set via metadata', () => {
    const a = newDoc('A')
    updateFrontmatter(db, a, { status: 'draft', tags: ['research'] })

    // Simulate an agent body patch: rewrite the document body via updateDocument
    // (the same call applyEdit makes after a markdown find-and-replace).
    const body = tiptapToMarkdown(JSON.parse(getDocument(db, a)!.content!) as TTDoc)
    const newDocJson = JSON.stringify(markdownToTiptap(`${body}\n\nAdded a line.`))
    updateDocument(db, a, { content: newDocJson })

    const after = getDocument(db, a)!
    expect(after.frontmatter?.status).toBe('draft')
    expect(after.frontmatter?.tags).toEqual(['research'])
  })
})
