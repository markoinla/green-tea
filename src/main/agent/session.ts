import type Database from 'better-sqlite3'
import { type BrowserWindow } from 'electron'
import { mkdirSync } from 'fs'
import {
  createAgentSession,
  AuthStorage,
  type AgentSessionEventListener,
  SessionManager,
  DefaultResourceLoader,
  loadSkillsFromDir,
  createCodingTools
} from '@mariozechner/pi-coding-agent'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { getModel, type Model } from '@mariozechner/pi-ai'
import { createNotesTools } from './tools/notes-tools'
import { blocksToFlatDocJSON, getCurrentMarkdown } from './tools/notes-write'
import {
  loadSandboxConfig,
  initializeSandbox,
  resetSandbox,
  createSandboxedBashOps,
  isSandboxInitialized
} from './sandbox'
import { updateAgentLogStatus } from '../database/repositories/agent-logs'
import { getDocument } from '../database/repositories/documents'
import { createVersion } from '../database/repositories/document-versions'
import { getWorkspace } from '../database/repositories/workspaces'
import type { SerializableBlock } from '../markdown/types'
import { deserializeMarkdown } from '../markdown/deserialize'
import { createBlock, deleteBlock } from '../database/repositories/blocks'
import { getSetting } from '../database/repositories/settings'
import { getSkillsDir } from '../skills/manager'
import { getAgentBaseDir, getAgentWorkDir } from './paths'
import { buildSystemPrompt } from './system-prompt'
import { getMcpManager } from '../mcp'
import { getEnabledServices } from '../google'
import { getEnabledMicrosoftServices } from '../microsoft'

// ---- Shared Model Config ----

export function getModelConfig(db: Database.Database): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>
  authStorage: AuthStorage
} {
  const authStorage = AuthStorage.create()
  const aiProvider = getSetting(db, 'aiProvider') || 'default'
  const reasoningMode = getSetting(db, 'reasoningMode') === 'true'

  const anthropicApiKey = getSetting(db, 'anthropicApiKey')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let model: Model<any>

  const togetherCompat = {
    thinkingFormat: 'zai' as const,
    supportsDeveloperRole: false,
    supportsStore: false,
    supportsReasoningEffort: false,
    maxTokensField: 'max_tokens' as const
  }

  if (aiProvider === 'default') {
    authStorage.setRuntimeApiKey('together', 'proxy')
    model = {
      id: 'green-tea',
      name: 'Green Tea',
      api: 'openai-completions',
      provider: 'together',
      baseUrl: 'https://greentea-proxy.m-6bb.workers.dev/v1',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 131072,
      maxTokens: 16384,
      compat: togetherCompat
    } satisfies Model<'openai-completions'>
  } else if (aiProvider === 'together') {
    const togetherApiKey = getSetting(db, 'togetherApiKey')
    if (!togetherApiKey) {
      throw new Error(
        'No Together AI API key configured. Open Settings from the sidebar to add your API key.'
      )
    }
    authStorage.setRuntimeApiKey('together', togetherApiKey)

    const togetherModelId = getSetting(db, 'togetherModel') || 'moonshotai/Kimi-K2.5'
    model = {
      id: togetherModelId,
      name: togetherModelId,
      api: 'openai-completions',
      provider: 'together',
      baseUrl: 'https://api.together.xyz/v1',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 131072,
      maxTokens: 16384,
      compat: togetherCompat
    } satisfies Model<'openai-completions'>
  } else if (aiProvider === 'openrouter') {
    const openrouterApiKey = getSetting(db, 'openrouterApiKey')
    if (!openrouterApiKey) {
      throw new Error(
        'No OpenRouter API key configured. Open Settings from the sidebar to add your API key.'
      )
    }
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
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: 16384,
      compat: openrouterCompat
    } satisfies Model<'openai-completions'>
  } else {
    if (!anthropicApiKey) {
      throw new Error(
        'No Anthropic API key configured. Open Settings from the sidebar to add your API key.'
      )
    }
    authStorage.setRuntimeApiKey('anthropic', anthropicApiKey)

    const modelId = getSetting(db, 'anthropicModel') || 'claude-sonnet-4-6'
    model = getModel('anthropic', modelId as Parameters<typeof getModel>[1])
    if (!reasoningMode) {
      model = { ...model, reasoning: false }
    }
  }

  return { model, authStorage }
}

// ---- Shared Edit Application ----

export function applyEdit(db: Database.Database, logId: string): void {
  const log = db.prepare('SELECT * FROM agent_logs WHERE id = ?').get(logId) as
    | {
        id: string
        document_id: string | null
        input_markdown: string | null
        output_patch: string | null
        old_text: string | null
        new_text: string | null
      }
    | undefined

  if (!log) {
    throw new Error(`Agent log not found: ${logId}`)
  }
  if (!log.document_id) {
    throw new Error('No document_id associated with this edit')
  }

  const doc = getDocument(db, log.document_id)
  if (!doc) {
    throw new Error(`Document not found: ${log.document_id}`)
  }

  // Snapshot current state before applying the agent edit
  createVersion(db, {
    document_id: doc.id,
    title: doc.title,
    content: doc.content,
    source: 'agent_patch'
  })

  let newMarkdown: string

  if (log.old_text !== null && log.new_text !== null) {
    // New path: targeted find-and-replace against the current document state
    const current = getCurrentMarkdown(db, log.document_id)
    if (!current) {
      throw new Error(`Could not read current markdown for document: ${log.document_id}`)
    }

    if (!current.markdown.includes(log.old_text)) {
      updateAgentLogStatus(db, logId, 'stale')
      throw new Error('This edit is outdated — the document has changed since it was proposed.')
    }

    newMarkdown = current.markdown.replace(log.old_text, log.new_text)
  } else if (log.input_markdown) {
    // Legacy path: full snapshot replacement for old edits without old_text/new_text
    newMarkdown = log.input_markdown
  } else {
    throw new Error('No edit data found in this log entry')
  }

  const lines = newMarkdown.split('\n')
  let contentStart = 0
  if (lines.length > 0 && lines[0].startsWith('# ')) {
    const newTitle = lines[0].slice(2).trim()
    if (newTitle && newTitle !== doc.title) {
      db.prepare('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?').run(
        newTitle,
        new Date().toISOString(),
        log.document_id
      )
    }
    contentStart = 1
    while (contentStart < lines.length && lines[contentStart].trim() === '') {
      contentStart++
    }
  }
  const contentMarkdown = lines.slice(contentStart).join('\n')

  const newBlocks = deserializeMarkdown(contentMarkdown)

  const existingBlocks = db
    .prepare('SELECT id FROM blocks WHERE document_id = ?')
    .all(log.document_id) as Array<{ id: string }>
  for (const block of existingBlocks) {
    deleteBlock(db, block.id)
  }

  function createBlocksRecursive(
    blocks: SerializableBlock[],
    documentId: string,
    parentId?: string
  ): void {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      const created = createBlock(db, {
        document_id: documentId,
        parent_block_id: parentId,
        type: block.type,
        content: block.content,
        position: i
      })
      if (block.children.length > 0) {
        createBlocksRecursive(block.children, documentId, created.id)
      }
    }
  }

  createBlocksRecursive(newBlocks, log.document_id)

  const docJSON = blocksToFlatDocJSON(newBlocks)
  db.prepare('UPDATE documents SET content = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(docJSON),
    new Date().toISOString(),
    log.document_id
  )

  updateAgentLogStatus(db, logId, 'applied')
}

// ---- Agent Session Management ----

const activeSessions = new Map<string, AgentSession>()
const activeAbortControllers = new Map<string, AbortController>()

export async function createNotesAgentSession(
  db: Database.Database,
  window: BrowserWindow,
  conversationId: string,
  workspaceId?: string
): Promise<AgentSession> {
  const { model, authStorage } = getModelConfig(db)
  const reasoningMode = getSetting(db, 'reasoningMode') === 'true'

  const mcpManager = getMcpManager()
  mcpManager.loadConfig()
  const mcpServers = mcpManager
    .getServerStatuses()
    .filter((s) => s.status === 'connected')
    .map((s) => s.name)
  const customTools = createNotesTools(db, window, workspaceId)

  // Scope agent working directory per workspace
  const agentWorkDir = getAgentWorkDir(db, workspaceId)
  mkdirSync(agentWorkDir, { recursive: true })

  // Initialize OS-level sandbox — scoped to agentBaseDir so agent can write
  // to both agent-workspace/ and skills/
  const agentBaseDir = getAgentBaseDir(db)
  const sandboxConfig = loadSandboxConfig(agentBaseDir)
  await initializeSandbox(sandboxConfig)

  const toolsOptions = isSandboxInitialized()
    ? { bash: { operations: createSandboxedBashOps() } }
    : undefined

  const skillsDir = getSkillsDir(db)
  const disabledRaw = getSetting(db, 'disabledSkills')
  const disabledSkills: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
  const resourceLoader = new DefaultResourceLoader({
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: buildSystemPrompt(
      agentWorkDir,
      mcpServers,
      getEnabledServices(),
      getEnabledMicrosoftServices()
    ),
    skillsOverride: () => {
      const { skills, diagnostics } = loadSkillsFromDir({ dir: skillsDir, source: 'user' })
      return { skills: skills.filter((s) => !disabledSkills.includes(s.name)), diagnostics }
    }
  })
  await resourceLoader.reload()

  const { session } = await createAgentSession({
    cwd: agentWorkDir,
    model,
    tools: createCodingTools(agentWorkDir, toolsOptions),
    customTools,
    authStorage,
    sessionManager: SessionManager.inMemory(),
    resourceLoader,
    thinkingLevel: reasoningMode ? 'medium' : 'off'
  })

  // Subscribe to session events and forward to renderer
  const listener: AgentSessionEventListener = (event) => {
    if (window.isDestroyed()) return

    // Forward relevant events to the renderer process
    switch (event.type) {
      case 'message_start':
      case 'message_update':
      case 'message_end':
        window.webContents.send('agent:event', {
          type: event.type,
          conversationId,
          message: event.message
        })
        break
      case 'tool_execution_start':
        window.webContents.send('agent:event', {
          type: 'tool_start',
          conversationId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args
        })
        break
      case 'tool_execution_end':
        window.webContents.send('agent:event', {
          type: 'tool_end',
          conversationId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError
        })
        break
      case 'agent_start':
        window.webContents.send('agent:event', { type: 'agent_start', conversationId })
        break
      case 'agent_end': {
        let tokens: { input: number; output: number; total: number } | undefined
        try {
          const stats = session.getSessionStats()
          tokens = {
            input: stats.tokens.input,
            output: stats.tokens.output,
            total: stats.tokens.total
          }
        } catch {
          // stats may not be available yet
        }
        window.webContents.send('agent:event', { type: 'agent_end', conversationId, tokens })
        break
      }
    }
  }

  session.subscribe(listener)

  return session
}

export async function promptAgent(
  db: Database.Database,
  window: BrowserWindow,
  message: string,
  conversationId: string,
  documentId?: string,
  workspaceId?: string,
  references?: { id: string; title: string }[],
  images?: { data: string; mimeType: string }[],
  files?: { name: string; path: string }[]
): Promise<void> {
  if (!activeSessions.has(conversationId)) {
    const session = await createNotesAgentSession(db, window, conversationId, workspaceId)
    activeSessions.set(conversationId, session)
  }

  const session = activeSessions.get(conversationId)!

  // Add attached file paths to prompt context
  if (files && files.length > 0) {
    const fileList = files.map((f) => `- ${f.path}`).join('\n')
    message = `[The user attached these files:\n${fileList}\nUse the read tool or bash to process them.]\n\n${message}`
  }

  // Build contextual prompt
  let fullPrompt = message

  // Add date/time context
  const now = new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const dateStr = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  })
  fullPrompt = `[Current time: ${dateStr} (${timezone})]\n\n${fullPrompt}`

  // Add workspace context
  if (workspaceId) {
    const workspace = getWorkspace(db, workspaceId)
    if (workspace && workspace.memory) {
      fullPrompt = `[Workspace Memory:\n${workspace.memory}]\n\n${fullPrompt}`
    }
    if (workspace && workspace.description) {
      fullPrompt = `[Workspace Context — "${workspace.name}":\n${workspace.description}]\n\n${fullPrompt}`
    }
  }

  // Add currently viewed document context
  if (documentId) {
    const doc = getDocument(db, documentId)
    if (doc) {
      fullPrompt = `[Context: Currently viewing document "${doc.title}" (id: ${documentId})]\n\n${fullPrompt}`
    }
  }

  // Add referenced documents and files context
  if (references && references.length > 0) {
    const docRefs = references.filter((r) => !r.id.startsWith('file:'))
    const fileRefs = references.filter((r) => r.id.startsWith('file:'))

    if (docRefs.length > 0) {
      const refList = docRefs.map((r) => `"${r.title}" (id: ${r.id})`).join(', ')
      fullPrompt = `[The user referenced these notes: ${refList}. Use notes_get_markdown to read them if needed.]\n\n${fullPrompt}`
    }

    if (fileRefs.length > 0) {
      const fileList = fileRefs.map((r) => `- ${r.id.slice(5)}`).join('\n')
      fullPrompt = `[The user referenced these files:\n${fileList}\nUse relevant skills or the read tool to access them.]\n\n${fullPrompt}`
    }
  }

  // Workspace files context disabled
  // if (workspaceId) {
  //   const wsFiles = listWorkspaceFiles(db, workspaceId)
  //   if (wsFiles.length > 0) {
  //     const fileList = wsFiles.map((f) => `- ${f.file_path}`).join('\n')
  //     fullPrompt = `[Workspace Files:\n${fileList}\nUse relevant skills or the read tool to access these files when needed.]\n\n${fullPrompt}`
  //   }
  // }

  const abortController = new AbortController()
  activeAbortControllers.set(conversationId, abortController)
  try {
    const promptImages = images?.map((img) => ({
      type: 'image' as const,
      data: img.data,
      mimeType: img.mimeType
    }))
    await session.prompt(fullPrompt, {
      ...(promptImages?.length ? { images: promptImages } : {}),
      streamingBehavior: 'followUp'
    })
  } finally {
    activeAbortControllers.delete(conversationId)
  }
}

export async function resetSession(conversationId?: string): Promise<void> {
  if (conversationId) {
    const session = activeSessions.get(conversationId)
    if (session) {
      session.dispose()
      activeSessions.delete(conversationId)
    }
    activeAbortControllers.delete(conversationId)
  } else {
    for (const [, session] of activeSessions) {
      session.dispose()
    }
    activeSessions.clear()
    activeAbortControllers.clear()
  }
  await resetSandbox()
}

export function abortAgent(conversationId: string, window?: BrowserWindow): void {
  const controller = activeAbortControllers.get(conversationId)
  if (controller) {
    controller.abort()
    activeAbortControllers.delete(conversationId)
  }
  const session = activeSessions.get(conversationId)
  if (session) {
    session.abort()
  }

  // Safety net: always send agent_end so the UI never gets stuck in streaming state.
  // The library should fire this on its own, but if it doesn't (stuck API call, etc.)
  // we ensure the renderer recovers.
  if (window && !window.isDestroyed()) {
    setTimeout(() => {
      if (!window.isDestroyed()) {
        window.webContents.send('agent:event', { type: 'agent_end', conversationId })
      }
    }, 500)
  }
}

export function approveEdit(db: Database.Database, logId: string): string {
  applyEdit(db, logId)
  const log = db.prepare('SELECT document_id FROM agent_logs WHERE id = ?').get(logId) as
    | { document_id: string }
    | undefined
  return log?.document_id ?? ''
}

export function rejectEdit(db: Database.Database, logId: string): void {
  updateAgentLogStatus(db, logId, 'rejected')
}
