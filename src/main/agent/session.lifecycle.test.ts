/**
 * Lifecycle tests for promptAgent/abortAgent: session-creation race, the
 * agent_end-on-failure safety net, and cancellation of abortAgent's delayed
 * agent_end. Heavy session dependencies are mocked so createNotesAgentSession
 * resolves to a controllable fake session.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { createTestDb } from '../database/__test__/setup'

const h = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  commitWorkspaceAll: vi.fn(async () => null)
}))

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createAgentSession: h.createAgentSession,
    SessionManager: { inMemory: (): object => ({}) },
    DefaultResourceLoader: class {
      async reload(): Promise<void> {
        /* no-op */
      }
    },
    loadSkillsFromDir: (): object => ({ skills: [], diagnostics: [] }),
    createBashToolDefinition: (): object => ({})
  }
})
vi.mock('./sandbox', () => ({
  loadSandboxConfig: (): object => ({}),
  initializeSandbox: async (): Promise<void> => {},
  resetSandbox: async (): Promise<void> => {},
  createSandboxedBashOps: (): object => ({}),
  isSandboxInitialized: (): boolean => false
}))
vi.mock('./paths', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const dir = mkdtempSync(join(tmpdir(), 'gt-session-lifecycle-'))
  return {
    getAgentBaseDir: (): string => dir,
    getAgentWorkDir: (): string => dir,
    getWorkspaceDir: (): string => dir,
    getSettingsDir: (): string => dir
  }
})
vi.mock('./tools/notes-tools', () => ({
  createNotesTools: (): unknown[] => []
}))
vi.mock('./system-prompt', () => ({
  buildSystemPrompt: (): string => 'test prompt'
}))
vi.mock('../mcp', () => ({
  getMcpManager: (): object => ({
    loadConfig: (): void => {},
    getServerStatuses: (): unknown[] => []
  })
}))
vi.mock('../google', () => ({
  getEnabledServices: (): unknown[] => []
}))
vi.mock('../microsoft', () => ({
  getEnabledMicrosoftServices: (): unknown[] => []
}))
vi.mock('../plugins/skills', () => ({
  loadPluginSkills: (): unknown[] => [],
  pluginSkillId: (pluginId: string, name: string): string => `${pluginId}:${name}`
}))
vi.mock('../git/workspace-git', () => ({
  commitDocumentPreImage: async (): Promise<void> => {},
  commitWorkspaceAll: h.commitWorkspaceAll,
  commitAgentTurn: async (): Promise<void> => {}
}))

import { promptAgent, abortAgent, resetSession } from './session'
import { createDocument } from '../vault/documents-service'
import { createWorkspace } from '../database/repositories/workspaces'

type SentEvent = { type: string; conversationId: string }

function makeWindow(): { window: BrowserWindow; sent: SentEvent[] } {
  const sent: SentEvent[] = []
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (_channel: string, event: SentEvent) => {
        sent.push(event)
      }
    }
  } as unknown as BrowserWindow
  return { window, sent }
}

function makeFakeSession(): {
  subscribe: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  getSessionStats: () => { tokens: { input: number; output: number; total: number } }
} {
  return {
    subscribe: vi.fn(),
    prompt: vi.fn<(message: string) => Promise<void>>(async () => {}),
    dispose: vi.fn(),
    abort: vi.fn(),
    getSessionStats: () => ({ tokens: { input: 0, output: 0, total: 0 } })
  }
}

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
  h.createAgentSession.mockReset()
  h.commitWorkspaceAll.mockClear()
})

afterEach(async () => {
  vi.useRealTimers()
  await resetSession()
  db.close()
})

describe('promptAgent session-creation race', () => {
  it('two concurrent prompts for the same conversation share one session', async () => {
    const fake = makeFakeSession()
    h.createAgentSession.mockImplementation(async () => {
      // Simulate slow creation so the second prompt arrives mid-creation.
      await new Promise((r) => setTimeout(r, 20))
      return { session: fake }
    })

    const { window } = makeWindow()
    await Promise.all([
      promptAgent(db, window, 'first', 'conv-race'),
      promptAgent(db, window, 'second', 'conv-race')
    ])

    expect(h.createAgentSession).toHaveBeenCalledTimes(1)
    expect(fake.prompt).toHaveBeenCalledTimes(2)
  })
})

describe('promptAgent failure safety net', () => {
  it('emits agent_end and rethrows when session creation fails, then allows retry', async () => {
    h.createAgentSession.mockRejectedValueOnce(new Error('No API key configured'))
    const { window, sent } = makeWindow()

    await expect(promptAgent(db, window, 'hi', 'conv-fail')).rejects.toThrow(
      'No API key configured'
    )
    expect(sent).toContainEqual({ type: 'agent_end', conversationId: 'conv-fail' })

    // The rejected creation promise must not be cached — a retry re-creates.
    const fake = makeFakeSession()
    h.createAgentSession.mockResolvedValueOnce({ session: fake })
    await promptAgent(db, window, 'again', 'conv-fail')
    expect(fake.prompt).toHaveBeenCalledTimes(1)
  })

  it('emits agent_end and rethrows when session.prompt rejects mid-turn', async () => {
    const fake = makeFakeSession()
    fake.prompt.mockRejectedValueOnce(new Error('stream broke'))
    h.createAgentSession.mockResolvedValueOnce({ session: fake })
    const { window, sent } = makeWindow()

    await expect(promptAgent(db, window, 'hi', 'conv-mid')).rejects.toThrow('stream broke')
    expect(sent).toContainEqual({ type: 'agent_end', conversationId: 'conv-mid' })
  })
})

describe('abortAgent delayed agent_end safety net', () => {
  it('fires agent_end 500ms after abort when nothing supersedes it', async () => {
    vi.useFakeTimers()
    const { window, sent } = makeWindow()

    abortAgent('conv-abort', window)
    await vi.advanceTimersByTimeAsync(600)

    expect(sent).toContainEqual({ type: 'agent_end', conversationId: 'conv-abort' })
  })

  it('is cancelled when a new prompt starts before it fires', async () => {
    vi.useFakeTimers()
    const fake = makeFakeSession()
    h.createAgentSession.mockResolvedValueOnce({ session: fake })
    const { window, sent } = makeWindow()

    abortAgent('conv-reprompt', window)
    await promptAgent(db, window, 'new turn', 'conv-reprompt')
    await vi.advanceTimersByTimeAsync(600)

    // The stale post-abort agent_end must not land mid-new-turn.
    expect(sent.filter((e) => e.type === 'agent_end')).toHaveLength(0)
  })

  it('only the latest abort timer fires once for repeated aborts', async () => {
    vi.useFakeTimers()
    const { window, sent } = makeWindow()

    abortAgent('conv-double', window)
    await vi.advanceTimersByTimeAsync(200)
    abortAgent('conv-double', window)
    await vi.advanceTimersByTimeAsync(600)

    expect(sent.filter((e) => e.type === 'agent_end')).toHaveLength(1)
  })
})

describe('filesystem document context', () => {
  it('supplies file paths for the viewed note and mentioned notes', async () => {
    const workspace = createWorkspace(db, { name: 'Context' })
    const viewed = createDocument(db, { title: 'Viewed', workspace_id: workspace.id })
    const mentioned = createDocument(db, { title: 'Mentioned', workspace_id: workspace.id })
    const fake = makeFakeSession()
    h.createAgentSession.mockResolvedValue({ session: fake })
    const { window } = makeWindow()
    await promptAgent(db, window, 'Compare these', 'conv-files', viewed.id, workspace.id, [
      { id: mentioned.id, title: mentioned.title }
    ])
    const prompt = fake.prompt.mock.calls[0][0] as string
    expect(prompt).toContain(viewed.file_path)
    expect(prompt).toContain(mentioned.file_path)
    expect(prompt).not.toContain('notes_get_markdown')
    expect(h.commitWorkspaceAll).toHaveBeenCalledWith(
      db,
      workspace.id,
      'checkpoint: before agent turn'
    )
    expect(h.commitWorkspaceAll.mock.invocationCallOrder[0]).toBeLessThan(
      fake.prompt.mock.invocationCallOrder[0]
    )
  })
})
