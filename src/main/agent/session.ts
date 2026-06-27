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
  createBashToolDefinition
} from '@earendil-works/pi-coding-agent'
import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { Model } from '@earendil-works/pi-ai'
import { getBuiltinModel as getModel } from '@earendil-works/pi-ai/providers/all'
import { createNotesTools } from './tools/notes-tools'
import { getCurrentMarkdown } from './tools/notes-write'
import {
  loadSandboxConfig,
  initializeSandbox,
  resetSandbox,
  createSandboxedBashOps,
  isSandboxInitialized
} from './sandbox'
import { updateAgentLogStatus } from '../database/repositories/agent-logs'
import { getDocument, updateDocument, updateFrontmatter } from '../vault/documents-service'
import { createVersion } from '../database/repositories/document-versions'
import { getWorkspace } from '../database/repositories/workspaces'
import { markdownToTiptap } from '../markdown/tiptap-markdown'
import { getSetting } from '../database/repositories/settings'
import { getSkillsDir } from '../skills/manager'
import { getAgentBaseDir, getAgentWorkDir, getWorkspaceDir } from './paths'
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
  } else if (aiProvider === 'zenlayer') {
    const zenlayerApiKey = getSetting(db, 'zenlayerApiKey')
    if (!zenlayerApiKey) {
      throw new Error(
        'No Zenlayer AI Gateway API key configured. Open Settings from the sidebar to add your API key.'
      )
    }
    authStorage.setRuntimeApiKey('zenlayer', zenlayerApiKey)

    const zenlayerModelId = getSetting(db, 'zenlayerModel') || 'glm-5.2'
    // The gateway is OpenAI-compatible but does not implement the /v1/store
    // conversation API; it does accept OpenAI-style reasoning_effort.
    const zenlayerCompat = {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsReasoningEffort: true,
      maxTokensField: 'max_tokens' as const
    }
    model = {
      id: zenlayerModelId,
      name: zenlayerModelId,
      api: 'openai-completions',
      provider: 'zenlayer',
      baseUrl: 'https://gateway.theturbo.ai/v1',
      reasoning: reasoningMode,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: 16384,
      compat: zenlayerCompat
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

  // The first line is the title (rendered as an H1 by getCurrentMarkdown);
  // split it from the body and persist both through the file-backed service.
  const lines = newMarkdown.split('\n')
  let contentStart = 0
  let newTitle: string | undefined
  if (lines.length > 0 && lines[0].startsWith('# ')) {
    const parsedTitle = lines[0].slice(2).trim()
    if (parsedTitle && parsedTitle !== doc.title) newTitle = parsedTitle
    contentStart = 1
    while (contentStart < lines.length && lines[contentStart].trim() === '') {
      contentStart++
    }
  }
  const contentMarkdown = lines.slice(contentStart).join('\n')
  const newDoc = markdownToTiptap(contentMarkdown)

  // Write the agent's edit to the .md file (the source of truth) via the vault
  // service, which also refreshes the index and version history.
  updateDocument(db, log.document_id, {
    title: newTitle,
    content: JSON.stringify(newDoc)
  })

  updateAgentLogStatus(db, logId, 'applied')
}

/**
 * Apply a batched metadata proposal (Phase 5, C3). Unlike applyEdit (which
 * reconstructs the markdown body), this iterates the `metadata_payload` array of
 * `{ document_id, changedKeys }` and routes EACH through updateFrontmatter — the
 * single reserved-key chokepoint (M2) that merges only the changed keys and never
 * rewrites the body. Returns the list of affected document ids (for broadcast) and
 * the union of any reserved keys the chokepoint rejected (surfaced to the model).
 */
export function applyMetadataEdit(
  db: Database.Database,
  logId: string
): { documentIds: string[]; rejectedKeys: string[] } {
  const log = db.prepare('SELECT * FROM agent_logs WHERE id = ?').get(logId) as
    | { id: string; action_type: string; metadata_payload: string | null }
    | undefined

  if (!log) {
    throw new Error(`Agent log not found: ${logId}`)
  }
  if (!log.metadata_payload) {
    throw new Error('No metadata payload found in this log entry')
  }

  let edits: { document_id: string; changedKeys: Record<string, unknown> }[]
  try {
    edits = JSON.parse(log.metadata_payload)
  } catch {
    throw new Error('Corrupt metadata payload')
  }

  const documentIds: string[] = []
  const rejectedKeys = new Set<string>()
  for (const edit of edits) {
    const result = updateFrontmatter(db, edit.document_id, edit.changedKeys)
    documentIds.push(edit.document_id)
    for (const k of result.rejectedKeys) rejectedKeys.add(k)
  }

  updateAgentLogStatus(db, logId, 'applied')
  return { documentIds, rejectedKeys: [...rejectedKeys] }
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

  // Initialize OS-level sandbox — scoped to agentBaseDir (for skills/ and
  // default-location workspaces) plus the active workspace's vault dir so the
  // agent can write into user-picked folders that live outside agentBaseDir.
  const agentBaseDir = getAgentBaseDir(db)
  const workspaceVaultDir = getWorkspaceDir(db, workspaceId)
  const sandboxConfig = loadSandboxConfig(agentBaseDir, [workspaceVaultDir])
  await initializeSandbox(sandboxConfig)

  // When the sandbox is active, supply a custom bash tool backed by sandboxed
  // operations. It shares the built-in tool name 'bash', so the session registry
  // uses it in place of the built-in bash (custom tools override built-ins by name).
  const sandboxedBash: ToolDefinition[] = isSandboxInitialized()
    ? [
        createBashToolDefinition(agentWorkDir, {
          operations: createSandboxedBashOps()
        }) as ToolDefinition
      ]
    : []

  const skillsDir = getSkillsDir(db)
  const disabledRaw = getSetting(db, 'disabledSkills')
  const disabledSkills: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
  const resourceLoader = new DefaultResourceLoader({
    cwd: agentWorkDir,
    agentDir: agentBaseDir,
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
    // No `tools` allowlist: it would filter out custom tools too. Omitting it keeps
    // the default built-ins (read, bash, edit, write) plus all custom tools active.
    customTools: [...sandboxedBash, ...customTools],
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
      case 'tool_execution_end': {
        // Surface running token usage as the turn progresses so the UI counter
        // ticks live instead of snapping to a final value at agent_end.
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
        window.webContents.send('agent:event', {
          type: 'tool_end',
          conversationId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
          tokens
        })
        break
      }
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

/**
 * Approve a batched metadata proposal: apply it and return the affected document
 * ids (so the IPC layer can broadcast a content/metadata refresh for each) plus
 * any reserved keys the chokepoint rejected.
 */
export function approveMetadataEdit(
  db: Database.Database,
  logId: string
): { documentIds: string[]; rejectedKeys: string[] } {
  return applyMetadataEdit(db, logId)
}
