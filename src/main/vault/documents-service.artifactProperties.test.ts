import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { getWorkspaceVaultDir } from './paths'
import {
  reindexFile,
  deleteIndexRowByPath,
  updateFrontmatter,
  listByProperty,
  getDocument,
  searchDocuments
} from './documents-service'
import { getArtifactProperties } from '../database/repositories/artifact-properties'

let db: Database.Database
let base: string
let workspaceId: string
let vault: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-artprops-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'My Workspace' }).id
  vault = getWorkspaceVaultDir(db, workspaceId)
  mkdirSync(vault, { recursive: true })
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

function writeArtifact(name: string): string {
  const path = join(vault, name)
  writeFileSync(path, 'a,b\n1,2\n', 'utf-8')
  return path
}

describe('artifact metadata via updateFrontmatter', () => {
  it('writes user properties to artifact_properties and makes them queryable', () => {
    const path = writeArtifact('data.csv')
    const res = reindexFile(db, path)
    expect(res.kind).toBe('created')
    const id = (res as { docId: string }).docId

    const out = updateFrontmatter(db, id, { team: 'Platform', priority: 1 })
    expect(out.rejectedKeys).toEqual([])

    const rows = getArtifactProperties(db, id)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(byKey.team).toBe('Platform')
    expect(byKey.priority).toBe('1')

    // notes_query path (listByProperty) returns the artifact.
    const hits = listByProperty(db, workspaceId, 'team', 'platform')
    expect(hits.map((d) => d.id)).toContain(id)
  })

  it('surfaces artifact properties through getDocument frontmatter (renderer contract)', () => {
    const path = writeArtifact('panel.csv')
    const id = (reindexFile(db, path) as { docId: string }).docId
    updateFrontmatter(db, id, { team: 'Platform', tags: ['infra', 'urgent'] })

    // The Properties UI reads doc.frontmatter; artifacts carry no in-file YAML, so
    // getDocument must fold artifact_properties back into frontmatter.
    const doc = getDocument(db, id)
    expect(doc).toBeDefined()
    expect(doc!.kind).toBe('csv')
    expect(doc!.frontmatter).toEqual({ team: 'Platform', tags: ['infra', 'urgent'] })
  })

  it('rejects RESERVED_KEYS on artifacts', () => {
    const path = writeArtifact('r.csv')
    const id = (reindexFile(db, path) as { docId: string }).docId

    const out = updateFrontmatter(db, id, { title: 'nope', team: 'X' })
    expect(out.rejectedKeys).toContain('title')
    const rows = getArtifactProperties(db, id)
    expect(rows.map((r) => r.key)).toEqual(['team'])
  })
})

describe('tombstone on missing + clear on reappear', () => {
  it('tombstones (not deletes) a missing artifact that has properties and excludes it from queries', () => {
    const path = writeArtifact('keep.csv')
    const id = (reindexFile(db, path) as { docId: string }).docId
    updateFrontmatter(db, id, { team: 'Infra' })

    unlinkSync(path)
    const removed = deleteIndexRowByPath(db, path)
    expect(removed).toBe(id)

    // Row + properties survive, marked missing_at.
    const stillThere = db.prepare('SELECT missing_at FROM documents WHERE id = ?').get(id) as
      | { missing_at: string | null }
      | undefined
    expect(stillThere).toBeDefined()
    expect(stillThere!.missing_at).toBeTruthy()
    expect(getArtifactProperties(db, id).length).toBe(1)

    // Tombstoned rows are hidden from property queries.
    expect(listByProperty(db, workspaceId, 'team', 'infra')).toHaveLength(0)

    // ...and from the command-menu search path (both the empty-query recent list
    // and the FTS-match query), so the user can't open a tombstoned artifact whose
    // bytes are gone.
    expect(searchDocuments(db, '').map((d) => d.id)).not.toContain(id)
    expect(searchDocuments(db, 'keep').map((d) => d.id)).not.toContain(id)
  })

  it('getDocument on a tombstoned artifact preserves its properties (does not hard-delete)', () => {
    const path = writeArtifact('open.csv')
    const id = (reindexFile(db, path) as { docId: string }).docId
    updateFrontmatter(db, id, { team: 'Infra' })

    unlinkSync(path)
    deleteIndexRowByPath(db, path)

    // Opening/refreshing a tab on the tombstoned artifact must NOT destroy its
    // preserved properties (the whole point of the tombstone). It surfaces the
    // preserved frontmatter, and the row + EAV rows survive for clear-on-reappear.
    const doc = getDocument(db, id)
    expect(doc).toBeDefined()
    expect(doc!.frontmatter).toEqual({ team: 'Infra' })
    expect(getArtifactProperties(db, id).length).toBe(1)
    const stillTombstoned = db.prepare('SELECT missing_at FROM documents WHERE id = ?').get(id) as {
      missing_at: string | null
    }
    expect(stillTombstoned.missing_at).toBeTruthy()
  })

  it('hard-deletes a missing artifact with NO properties', () => {
    const path = writeArtifact('cache.csv')
    const id = (reindexFile(db, path) as { docId: string }).docId

    unlinkSync(path)
    deleteIndexRowByPath(db, path)

    expect(getDocument(db, id)).toBeUndefined()
  })

  it('clears the tombstone and restores queryability when the file reappears at the same path', () => {
    const path = writeArtifact('back.csv')
    const id = (reindexFile(db, path) as { docId: string }).docId
    updateFrontmatter(db, id, { team: 'Infra' })

    unlinkSync(path)
    deleteIndexRowByPath(db, path)
    expect(listByProperty(db, workspaceId, 'team', 'infra')).toHaveLength(0)

    // File reappears at the same path → same-path id reuse, missing_at cleared.
    writeArtifact('back.csv')
    const res = reindexFile(db, path)
    expect((res as { docId: string }).docId).toBe(id)

    const cleared = db.prepare('SELECT missing_at FROM documents WHERE id = ?').get(id) as {
      missing_at: string | null
    }
    expect(cleared.missing_at).toBeNull()
    expect(getArtifactProperties(db, id).length).toBe(1)
    expect(listByProperty(db, workspaceId, 'team', 'infra').map((d) => d.id)).toContain(id)
  })
})
