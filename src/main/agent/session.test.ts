import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { getModelConfig, applyEdit } from './session'
import { setSetting } from '../database/repositories/settings'
import { createWorkspace } from '../database/repositories/workspaces'
import { listDocuments, updateDocument } from '../vault/documents-service'
import { notesCreateDocument, notesProposeEdit, getCurrentMarkdown } from './tools/notes-write'
import { markdownToTiptap } from '../markdown/tiptap-markdown'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

describe('getModelConfig', () => {
  it('returns green-tea model with proxy URL for default provider', () => {
    // Default provider (no aiProvider setting set)
    const { model } = getModelConfig(db)
    expect(model.id).toBe('green-tea')
    expect(model.name).toBe('Green Tea')
    expect(model.baseUrl).toBe('https://greentea-proxy.m-6bb.workers.dev/v1')
    expect(model.provider).toBe('together')
  })

  it('uses together provider with custom API key', () => {
    setSetting(db, 'aiProvider', 'together')
    setSetting(db, 'togetherApiKey', 'test-key-123')

    const { model } = getModelConfig(db)
    expect(model.provider).toBe('together')
    expect(model.baseUrl).toBe('https://api.together.xyz/v1')
  })

  it('throws when together provider has no API key', () => {
    setSetting(db, 'aiProvider', 'together')

    expect(() => getModelConfig(db)).toThrow('No Together AI API key configured')
  })

  it('uses openrouter provider with custom API key', () => {
    setSetting(db, 'aiProvider', 'openrouter')
    setSetting(db, 'openrouterApiKey', 'or-key-123')

    const { model } = getModelConfig(db)
    expect(model.provider).toBe('openrouter')
    expect(model.baseUrl).toBe('https://openrouter.ai/api/v1')
  })

  it('throws when openrouter provider has no API key', () => {
    setSetting(db, 'aiProvider', 'openrouter')

    expect(() => getModelConfig(db)).toThrow('No OpenRouter API key configured')
  })

  it('uses zenlayer provider with custom API key', () => {
    setSetting(db, 'aiProvider', 'zenlayer')
    setSetting(db, 'zenlayerApiKey', 'zl-key-123')

    const { model } = getModelConfig(db)
    expect(model.provider).toBe('zenlayer')
    expect(model.baseUrl).toBe('https://gateway.theturbo.ai/v1')
    expect(model.id).toBe('glm-5.2')
  })

  it('throws when zenlayer provider has no API key', () => {
    setSetting(db, 'aiProvider', 'zenlayer')

    expect(() => getModelConfig(db)).toThrow('No Zenlayer AI Gateway API key configured')
  })

  it('uses custom zenlayer model ID when configured', () => {
    setSetting(db, 'aiProvider', 'zenlayer')
    setSetting(db, 'zenlayerApiKey', 'zl-key')
    setSetting(db, 'zenlayerModel', 'claude-opus-4-8')

    const { model } = getModelConfig(db)
    expect(model.id).toBe('claude-opus-4-8')
  })

  it('throws when anthropic provider has no API key', () => {
    setSetting(db, 'aiProvider', 'anthropic')

    expect(() => getModelConfig(db)).toThrow('No Anthropic API key configured')
  })

  it('uses anthropic provider with API key', () => {
    setSetting(db, 'aiProvider', 'anthropic')
    setSetting(db, 'anthropicApiKey', 'sk-ant-test')

    const { model } = getModelConfig(db)
    expect(model.provider).toBe('anthropic')
  })

  it('uses custom together model ID when configured', () => {
    setSetting(db, 'aiProvider', 'together')
    setSetting(db, 'togetherApiKey', 'test-key')
    setSetting(db, 'togetherModel', 'meta-llama/Llama-3-70b')

    const { model } = getModelConfig(db)
    expect(model.id).toBe('meta-llama/Llama-3-70b')
  })

  it('uses custom openrouter model ID when configured', () => {
    setSetting(db, 'aiProvider', 'openrouter')
    setSetting(db, 'openrouterApiKey', 'or-key')
    setSetting(db, 'openrouterModel', 'anthropic/claude-3.5-sonnet')

    const { model } = getModelConfig(db)
    expect(model.id).toBe('anthropic/claude-3.5-sonnet')
  })

  it('respects reasoning mode setting', () => {
    setSetting(db, 'aiProvider', 'openrouter')
    setSetting(db, 'openrouterApiKey', 'key')
    setSetting(db, 'reasoningMode', 'true')

    const { model } = getModelConfig(db)
    expect(model.reasoning).toBe(true)
  })
})

describe('applyEdit re-checks old_text uniqueness at apply time', () => {
  let base: string
  let workspaceId: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'gt-session-apply-'))
    setSetting(db, 'agentBaseDir', base)
    workspaceId = createWorkspace(db, { name: 'WS' }).id
  })
  afterEach(() => {
    db.close()
    rmSync(base, { recursive: true, force: true })
  })

  function logStatus(logId: string): string {
    const row = db.prepare('SELECT status FROM agent_logs WHERE id = ?').get(logId) as {
      status: string
    }
    return row.status
  }

  async function proposeEdit(): Promise<{ documentId: string; logId: string }> {
    notesCreateDocument(db, { title: 'Note', markdown: 'alpha beta gamma' }, workspaceId)
    const documentId = listDocuments(db, workspaceId)[0].id
    const res = await notesProposeEdit(db, {
      document_id: documentId,
      old_text: 'beta',
      new_text: 'BETA'
    })
    expect(res.error).toBeUndefined()
    return { documentId, logId: res.log!.id }
  }

  it('applies when old_text still occurs exactly once', async () => {
    const { documentId, logId } = await proposeEdit()

    await applyEdit(db, logId)

    expect(logStatus(logId)).toBe('applied')
    expect(getCurrentMarkdown(db, documentId)!.markdown).toContain('alpha BETA gamma')
  })

  it('marks the log stale when a user edit made old_text ambiguous', async () => {
    const { documentId, logId } = await proposeEdit()

    // User edits the note between propose and approve: 'beta' now occurs twice,
    // so a plain .replace() would silently rewrite the wrong (first) instance.
    updateDocument(db, documentId, {
      content: JSON.stringify(markdownToTiptap('alpha beta gamma\n\nbeta again'))
    })

    await expect(applyEdit(db, logId)).rejects.toThrow('outdated')
    expect(logStatus(logId)).toBe('stale')
    // Document is untouched.
    expect(getCurrentMarkdown(db, documentId)!.markdown).not.toContain('BETA')
  })

  it('marks the log stale when old_text no longer occurs', async () => {
    const { documentId, logId } = await proposeEdit()

    updateDocument(db, documentId, {
      content: JSON.stringify(markdownToTiptap('alpha gamma'))
    })

    await expect(applyEdit(db, logId)).rejects.toThrow('outdated')
    expect(logStatus(logId)).toBe('stale')
  })
})
