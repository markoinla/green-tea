import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { getModelConfig } from './session'
import { setSetting } from '../database/repositories/settings'

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
