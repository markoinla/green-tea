import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { createDocument } from '../vault/documents-service'
import { upsertShare } from '../database/repositories/shares'
import { updateSharedVersion } from './share-service'

// The frontmatter UUID is the note's docKey identity (see computeDocKey). Tests
// that pre-seed a share row must key it the same way the service will look it up.
function shareKeyForNote(fmId: string): string {
  return `note:${fmId}`
}

let db: Database.Database
let base: string
let workspaceId: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-share-svc-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'WS' }).id
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('updateSharedVersion — update-only safety', () => {
  it('reports not-shared and never contacts the worker when the doc has no share', async () => {
    setSetting(db, 'share.publishToken', 'tok')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const doc = createDocument(db, { title: 'Note', workspace_id: workspaceId })

    const result = await updateSharedVersion(db, doc.id)

    expect(result).toEqual({ status: 'not-shared' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports no-token (and skips the worker) when no publish token is configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const doc = createDocument(db, { title: 'Note', workspace_id: workspaceId })
    // Even an already-shared doc must not be touched without a token.
    const fmId = (doc.frontmatter?.id as string) ?? doc.id
    upsertShare(db, shareKeyForNote(fmId), {
      slug: 's1',
      url: 'https://share.greentea.app/s1',
      type: 'note',
      workspaceId,
      filePath: doc.file_path,
      title: 'Note'
    })

    const result = await updateSharedVersion(db, doc.id)

    expect(result).toEqual({ status: 'no-token' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports unsupported for a missing document', async () => {
    setSetting(db, 'share.publishToken', 'tok')
    const result = await updateSharedVersion(db, 'does-not-exist')
    expect(result.status).toBe('unsupported')
  })
})
