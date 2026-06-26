import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { markdownToTiptap, type TTDoc } from '../markdown/tiptap-markdown'
import { createDocument, getDocument, resolveWikiLinks, getBacklinks } from './documents-service'

let db: Database.Database
let base: string
let workspaceId: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-wikilinks-'))
  db = createTestDb()
  setSetting(db, 'agentBaseDir', base)
  workspaceId = createWorkspace(db, { name: 'My Workspace' }).id
})
afterEach(() => {
  db.close()
  rmSync(base, { recursive: true, force: true })
})

const content = (md: string): string => JSON.stringify(markdownToTiptap(md))

function wikiNodes(doc: TTDoc): { label: unknown; docId: unknown }[] {
  const out: { label: unknown; docId: unknown }[] = []
  const walk = (n: {
    type: string
    attrs?: Record<string, unknown>
    content?: unknown[]
  }): void => {
    if (n.type === 'wikiLink') out.push({ label: n.attrs?.label, docId: n.attrs?.docId })
    if (Array.isArray(n.content)) for (const c of n.content) walk(c as typeof n)
  }
  for (const n of doc.content) walk(n as never)
  return out
}

describe('resolveWikiLinks', () => {
  it('resolves a label to a same-workspace doc id (case-insensitive)', () => {
    const target = createDocument(db, { title: 'Target Note', workspace_id: workspaceId })
    const doc = markdownToTiptap('See [[target note]] here')
    resolveWikiLinks(db, workspaceId, doc)
    expect(wikiNodes(doc)).toEqual([{ label: 'target note', docId: target.id }])
  })

  it('leaves docId null for an unresolved (broken) link', () => {
    const doc = markdownToTiptap('See [[No Such Note]] here')
    resolveWikiLinks(db, workspaceId, doc)
    expect(wikiNodes(doc)).toEqual([{ label: 'No Such Note', docId: null }])
  })

  it('does not resolve across workspaces', () => {
    const other = createWorkspace(db, { name: 'Other' }).id
    createDocument(db, { title: 'Elsewhere', workspace_id: other })
    const doc = markdownToTiptap('[[Elsewhere]]')
    resolveWikiLinks(db, workspaceId, doc)
    expect(wikiNodes(doc)).toEqual([{ label: 'Elsewhere', docId: null }])
  })

  it('treats an empty/whitespace label as unresolved', () => {
    const doc: TTDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'wikiLink', attrs: { label: '  ', docId: null } }] }
      ]
    }
    resolveWikiLinks(db, workspaceId, doc)
    expect(wikiNodes(doc)).toEqual([{ label: '  ', docId: null }])
  })
})

describe('getDocument resolves wiki-links in the mirrored content', () => {
  it('fills docId on read once the target exists', () => {
    const target = createDocument(db, { title: 'Other Note', workspace_id: workspaceId })
    const source = createDocument(db, {
      title: 'Source',
      workspace_id: workspaceId,
      content: content('Links to [[Other Note]]')
    })

    const got = getDocument(db, source.id)
    const doc = JSON.parse(got!.content!) as TTDoc
    expect(wikiNodes(doc)).toEqual([{ label: 'Other Note', docId: target.id }])
  })
})

describe('getBacklinks', () => {
  it('returns notes that link to the target with a snippet', () => {
    const target = createDocument(db, { title: 'Target Note', workspace_id: workspaceId })
    createDocument(db, {
      title: 'Source',
      workspace_id: workspaceId,
      content: content('Mentions [[Target Note]] in passing')
    })

    const backlinks = getBacklinks(db, target.id)
    expect(backlinks).toHaveLength(1)
    expect(backlinks[0].title).toBe('Source')
    expect(backlinks[0].snippet).toContain('[[Target Note]]')
  })

  it('matches case-insensitively and excludes the note itself', () => {
    const target = createDocument(db, {
      title: 'Target Note',
      workspace_id: workspaceId,
      content: content('A self [[target note]] reference')
    })
    createDocument(db, {
      title: 'Other',
      workspace_id: workspaceId,
      content: content('Points to [[TARGET NOTE]] here')
    })

    const backlinks = getBacklinks(db, target.id)
    expect(backlinks.map((b) => b.title)).toEqual(['Other'])
  })

  it('does not cross workspaces and returns [] when nothing links', () => {
    const target = createDocument(db, { title: 'Lonely', workspace_id: workspaceId })
    const other = createWorkspace(db, { name: 'Other' }).id
    createDocument(db, {
      title: 'Elsewhere',
      workspace_id: other,
      content: content('Links to [[Lonely]] from another vault')
    })

    expect(getBacklinks(db, target.id)).toEqual([])
  })
})
