import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import {
  createAgentSession,
  AuthStorage,
  type AgentSessionEventListener,
  SessionManager,
  DefaultResourceLoader,
  createCodingTools
} from '@mariozechner/pi-coding-agent'
import type { AgentSession, ToolDefinition } from '@mariozechner/pi-coding-agent'
import { getModel, type Model } from '@mariozechner/pi-ai'
import type { AgentConfig } from './agents'
import { createNotesTools } from '../tools/notes-tools'
import { getSetting } from '../../database/repositories/settings'
import { getAgentWorkDir } from '../paths'
import { createSandboxedBashOps, isSandboxInitialized } from '../sandbox'

export interface SubagentResult {
  output: string
  isError: boolean
}

export async function createSubagentSession(
  db: Database.Database,
  window: BrowserWindow,
  agentConfig: AgentConfig,
  workspaceId?: string
): Promise<AgentSession> {
  const authStorage = AuthStorage.create()
  const aiProvider = getSetting(db, 'aiProvider') || 'default'
  const anthropicApiKey = getSetting(db, 'anthropicApiKey')
  const reasoningMode = getSetting(db, 'reasoningMode') === 'true'

  // Together AI model compat: uses zai-style thinking param, rejects developer role,
  // requires max_tokens (not max_completion_tokens), and rejects store param
  const togetherCompat = {
    thinkingFormat: 'zai' as const,
    supportsDeveloperRole: false,
    supportsStore: false,
    supportsReasoningEffort: false,
    maxTokensField: 'max_tokens' as const
  }

  // Resolve model — use agent-specific model if defined, else fall back to user's configured model
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let model: Model<any>

  if (agentConfig.model) {
    // Agent specifies a model — needs appropriate auth
    if (agentConfig.model.startsWith('claude-')) {
      if (!anthropicApiKey) {
        throw new Error(
          `Agent "${agentConfig.name}" requires Anthropic model ${agentConfig.model} but no API key is configured.`
        )
      }
      authStorage.setRuntimeApiKey('anthropic', anthropicApiKey)
      model = getModel('anthropic', agentConfig.model as Parameters<typeof getModel>[1])
      if (!reasoningMode) {
        model = { ...model, reasoning: false }
      }
    } else if (agentConfig.model.startsWith('green-tea-')) {
      // Proxy-aliased model — always route through the Green Tea proxy
      authStorage.setRuntimeApiKey('together', 'proxy')
      model = {
        id: agentConfig.model,
        name: agentConfig.model,
        api: 'openai-completions',
        provider: 'together',
        baseUrl: 'https://greentea-proxy.m-6bb.workers.dev/v1',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 16384,
        compat: togetherCompat
      } satisfies Model<'openai-completions'>
    } else {
      // Non-Claude model — use Together AI, OpenRouter, or proxied
      if (aiProvider === 'openrouter') {
        const openrouterApiKey = getSetting(db, 'openrouterApiKey')
        if (!openrouterApiKey) throw new Error('No OpenRouter API key configured.')
        authStorage.setRuntimeApiKey('openrouter', openrouterApiKey)
        const openrouterCompat = {
          supportsDeveloperRole: true,
          supportsStore: false,
          supportsReasoningEffort: true,
          maxTokensField: 'max_tokens' as const
        }
        model = {
          id: agentConfig.model,
          name: agentConfig.model,
          api: 'openai-completions',
          provider: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          reasoning: reasoningMode,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1000000,
          maxTokens: 16384,
          compat: openrouterCompat
        } satisfies Model<'openai-completions'>
      } else {
        if (aiProvider === 'together') {
          const togetherApiKey = getSetting(db, 'togetherApiKey')
          if (!togetherApiKey) throw new Error('No Together AI API key configured.')
          authStorage.setRuntimeApiKey('together', togetherApiKey)
        } else {
          authStorage.setRuntimeApiKey('together', 'proxy')
        }
        model = {
          id: agentConfig.model,
          name: agentConfig.model,
          api: 'openai-completions',
          provider: 'together',
          baseUrl:
            aiProvider === 'together'
              ? 'https://api.together.xyz/v1'
              : 'https://greentea-proxy.m-6bb.workers.dev/v1',
          reasoning: true,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 131072,
          maxTokens: 16384,
          compat: togetherCompat
        } satisfies Model<'openai-completions'>
      }
    }
  } else {
    // No agent-specific model — reuse the exact logic from session.ts
    if (aiProvider === 'default') {
      authStorage.setRuntimeApiKey('together', 'proxy')
      model = {
        id: 'green-tea',
        name: 'Green Tea',
        api: 'openai-completions',
        provider: 'together',
        baseUrl: 'https://greentea-proxy.m-6bb.workers.dev/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 16384,
        compat: togetherCompat
      } satisfies Model<'openai-completions'>
    } else if (aiProvider === 'together') {
      const togetherApiKey = getSetting(db, 'togetherApiKey')
      if (!togetherApiKey) throw new Error('No Together AI API key configured.')
      authStorage.setRuntimeApiKey('together', togetherApiKey)
      const togetherModelId = getSetting(db, 'togetherModel') || 'moonshotai/Kimi-K2.5'
      model = {
        id: togetherModelId,
        name: togetherModelId,
        api: 'openai-completions',
        provider: 'together',
        baseUrl: 'https://api.together.xyz/v1',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 16384,
        compat: togetherCompat
      } satisfies Model<'openai-completions'>
    } else if (aiProvider === 'openrouter') {
      const openrouterApiKey = getSetting(db, 'openrouterApiKey')
      if (!openrouterApiKey) throw new Error('No OpenRouter API key configured.')
      authStorage.setRuntimeApiKey('openrouter', openrouterApiKey)
      const openrouterModelId = getSetting(db, 'openrouterModel') || 'minimax/minimax-m2.1'
      const openrouterCompat = {
        supportsDeveloperRole: true,
        supportsStore: false,
        supportsReasoningEffort: true,
        maxTokensField: 'max_tokens' as const
      }
      model = {
        id: openrouterModelId,
        name: openrouterModelId,
        api: 'openai-completions',
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        reasoning: reasoningMode,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 16384,
        compat: openrouterCompat
      } satisfies Model<'openai-completions'>
    } else {
      if (!anthropicApiKey) throw new Error('No Anthropic API key configured.')
      authStorage.setRuntimeApiKey('anthropic', anthropicApiKey)
      const modelId = getSetting(db, 'anthropicModel') || 'claude-sonnet-4-6'
      model = getModel('anthropic', modelId as Parameters<typeof getModel>[1])
      if (!reasoningMode) {
        model = { ...model, reasoning: false }
      }
    }
  }

  // Build tool set based on agent's allowed tools
  const agentWorkDir = getAgentWorkDir(db, workspaceId)
  const toolsOptions = isSandboxInitialized()
    ? { bash: { operations: createSandboxedBashOps() } }
    : undefined

  const allCodingTools = createCodingTools(agentWorkDir, toolsOptions)
  const allNotesTools = createNotesTools(db, window, workspaceId)

  let filteredBuiltinTools = allCodingTools
  let filteredCustomTools: ToolDefinition[] = allNotesTools

  if (agentConfig.tools && agentConfig.tools.length > 0) {
    const allowedSet = new Set(agentConfig.tools)

    // Filter built-in tools (Tool[] from createCodingTools)
    filteredBuiltinTools = allCodingTools.filter((t) => allowedSet.has(t.name))

    // Filter custom tools (ToolDefinition[] from createNotesTools)
    filteredCustomTools = allNotesTools.filter((t) => allowedSet.has(t.name))
  }

  // Build system prompt for the subagent
  const systemPromptParts = [
    `You are a specialized sub-agent called "${agentConfig.name}".`,
    agentConfig.systemPrompt,
    `Your working directory is ${agentWorkDir}. All file operations must happen inside this directory.`
  ]

  const resourceLoader = new DefaultResourceLoader({
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    appendSystemPrompt: systemPromptParts.join('\n\n')
  })
  await resourceLoader.reload()

  const { session } = await createAgentSession({
    cwd: agentWorkDir,
    model,
    tools: filteredBuiltinTools,
    customTools: filteredCustomTools,
    authStorage,
    sessionManager: SessionManager.inMemory(),
    resourceLoader,
    thinkingLevel: reasoningMode ? 'medium' : 'off'
  })

  return session
}

export async function runSubagent(
  db: Database.Database,
  window: BrowserWindow,
  agentConfig: AgentConfig,
  task: string,
  workspaceId?: string,
  signal?: AbortSignal
): Promise<SubagentResult> {
  const session = await createSubagentSession(db, window, agentConfig, workspaceId)

  try {
    if (signal?.aborted) {
      return { output: 'Aborted before execution.', isError: true }
    }

    // Combine caller's abort signal with a timeout if configured
    const abortController = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let hitTurnLimit = false
    let hitTimeout = false

    if (agentConfig.timeoutMs) {
      timeoutId = setTimeout(() => {
        hitTimeout = true
        abortController.abort()
      }, agentConfig.timeoutMs)
    }

    // Propagate caller abort
    const callerAbortHandler = (): void => {
      abortController.abort()
    }
    signal?.addEventListener('abort', callerAbortHandler)

    // Forward subagent events to renderer and enforce turn limit
    let turnCount = 0
    const listener: AgentSessionEventListener = (event) => {
      if (window.isDestroyed()) return

      // Count turns and enforce limit
      if (event.type === 'turn_end') {
        turnCount++
        if (agentConfig.maxTurns && turnCount >= agentConfig.maxTurns) {
          hitTurnLimit = true
          abortController.abort()
        }
      }

      // Only forward tool events — skip message events to avoid cluttering the main chat
      if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
        window.webContents.send('agent:subagent-event', {
          ...event,
          agentName: agentConfig.name
        })
      }
    }
    session.subscribe(listener)

    // Listen for combined abort
    const abortHandler = (): void => {
      session.abort()
    }
    abortController.signal.addEventListener('abort', abortHandler)

    try {
      await session.prompt(task)
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      signal?.removeEventListener('abort', callerAbortHandler)
      abortController.signal.removeEventListener('abort', abortHandler)
    }

    // Extract the last assistant text message from the session
    const messages = session.messages
    let output = ''
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { role?: string; content?: unknown }
      if (msg.role === 'assistant') {
        // Extract text content from the message
        if (typeof msg.content === 'string') {
          output = msg.content
        } else if (Array.isArray(msg.content)) {
          output = msg.content
            .filter((c: { type: string }) => c.type === 'text')
            .map((c: { type: string; text: string }) => c.text)
            .join('\n')
        }
        if (output.trim()) break
      }
    }

    // Append limit notice if applicable
    if (hitTurnLimit) {
      output += `\n\n[Stopped: reached ${agentConfig.maxTurns}-turn limit]`
    } else if (hitTimeout) {
      output += `\n\n[Stopped: reached ${Math.round(agentConfig.timeoutMs! / 1000)}s timeout]`
    }

    return { output: output || '(No output from subagent)', isError: false }
  } finally {
    session.dispose()
  }
}
