import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  Document,
  DocumentVersion,
  Block,
  BlockNode,
  AgentLog,
  Folder,
  Workspace,
  WorkspaceFile,
  Conversation,
  ConversationMessage
} from '../main/database/types'

interface SkillInfo {
  name: string
  description: string
  enabled: boolean
}

interface MarketplaceSkillInfo {
  name: string
  description: string
  author: string
  version: string
  path: string
}

interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  transport?: 'stdio' | 'http'
  url?: string
  lifecycle?: 'lazy' | 'eager'
  idleTimeout?: number
  enabled?: boolean
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
}

interface McpServerStatus {
  name: string
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  toolCount: number
  authStatus: 'none' | 'authenticated' | 'unauthenticated'
}

interface ThemeData {
  editorFontSize?: string
  uiFontSize?: string
  codeFontSize?: string
  editorBodyFont?: string
  editorHeadingFont?: string
  lightBackground?: string
  darkBackground?: string
  radius?: string
  light?: Record<string, string>
  dark?: Record<string, string>
}

type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

interface GreenteaApi {
  workspaces: {
    list(): Promise<Workspace[]>
    get(id: string): Promise<Workspace | undefined>
    create(data: { name: string }): Promise<Workspace>
    update(id: string, data: { name?: string; description?: string }): Promise<Workspace>
    delete(id: string): Promise<void>
  }
  documents: {
    list(workspaceId?: string): Promise<Document[]>
    search(query: string): Promise<(Document & { workspace_name: string })[]>
    get(id: string): Promise<Document | undefined>
    create(data: {
      title: string
      workspace_id?: string
      content?: string
      folder_id?: string | null
    }): Promise<Document>
    update(
      id: string,
      data: { title?: string; workspace_id?: string; content?: string; folder_id?: string | null }
    ): Promise<Document>
    delete(id: string): Promise<void>
  }
  folders: {
    list(workspaceId?: string): Promise<Folder[]>
    create(data: { name: string; workspace_id?: string }): Promise<Folder>
    update(id: string, data: { name?: string; collapsed?: number }): Promise<Folder>
    delete(id: string): Promise<void>
  }
  blocks: {
    getTree(documentId: string): Promise<BlockNode[]>
    get(id: string): Promise<Block | undefined>
    create(data: {
      document_id: string
      parent_block_id?: string
      type?: string
      content?: string
      position?: number
    }): Promise<Block>
    update(
      id: string,
      data: { type?: string; content?: string; collapsed?: number; position?: number }
    ): Promise<Block>
    delete(id: string): Promise<void>
    move(id: string, data: { parent_block_id?: string; position: number }): Promise<void>
  }
  markdown: {
    serialize(documentId: string): Promise<string>
    deserialize(markdown: string): Promise<BlockNode[]>
  }
  agent: {
    prompt(data: {
      message: string
      conversationId: string
      documentId?: string
      workspaceId?: string
      references?: { id: string; title: string }[]
      images?: { data: string; mimeType: string }[]
      files?: { name: string; path: string }[]
    }): Promise<void>
    abort(conversationId: string): Promise<void>
    resetSession(conversationId?: string): Promise<void>
    approveEdit(logId: string): Promise<void>
    rejectEdit(logId: string): Promise<void>
    generateTitle(data: { conversationId: string; userMessage: string }): Promise<void>
    onEvent(callback: (data: unknown) => void): () => void
    onSubagentEvent(callback: (data: unknown) => void): () => void
  }
  documentVersions: {
    list(documentId: string): Promise<DocumentVersion[]>
    get(id: string): Promise<DocumentVersion | undefined>
    create(data: {
      document_id: string
      title: string
      content: string | null
    }): Promise<DocumentVersion>
    restore(id: string): Promise<void>
    delete(id: string): Promise<void>
  }
  onDocumentVersionsChanged(callback: () => void): () => void
  onDocumentsChanged(callback: () => void): () => void
  onDocumentContentChanged(callback: (data: { id: string }) => void): () => void
  onFoldersChanged(callback: () => void): () => void
  onWorkspacesChanged(callback: () => void): () => void
  settings: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    getAll(): Promise<Record<string, string>>
    testApiKey(provider: string, apiKey: string): Promise<{ success: boolean; error?: string }>
  }
  onSettingsChanged(callback: () => void): () => void
  agentLogs: {
    list(filter?: { document_id?: string; status?: string }): Promise<AgentLog[]>
  }
  skills: {
    list(): Promise<SkillInfo[]>
    install(url: string): Promise<SkillInfo>
    remove(name: string): Promise<void>
    toggle(name: string, enabled: boolean): Promise<void>
    marketplaceList(): Promise<MarketplaceSkillInfo[]>
    marketplaceRefresh(): Promise<MarketplaceSkillInfo[]>
  }
  onSkillsChanged(callback: () => void): () => void
  mcp: {
    getConfig(): Promise<McpConfig>
    saveConfig(config: McpConfig): Promise<void>
    getStatuses(): Promise<McpServerStatus[]>
    testConnection(name: string): Promise<{ success: boolean; toolCount?: number; error?: string }>
    disconnect(name: string): Promise<void>
    authenticate(name: string): Promise<{ success: boolean; error?: string }>
    clearAuth(name: string): Promise<void>
  }
  onMcpChanged(callback: () => void): () => void
  google: {
    connectService(service: string): Promise<{ success: boolean; error?: string }>
    disconnectService(service: string): Promise<void>
    clearAuth(): Promise<void>
    getStatus(): Promise<{
      authenticated: boolean
      email?: string
      scopes: string[]
      enabledServices: string[]
    }>
  }
  onGoogleChanged(callback: () => void): () => void
  microsoft: {
    connectService(service: string): Promise<{ success: boolean; error?: string }>
    disconnectService(service: string): Promise<void>
    clearAuth(): Promise<void>
    getStatus(): Promise<{
      authenticated: boolean
      email?: string
      displayName?: string
      scopes: string[]
      enabledServices: string[]
    }>
  }
  onMicrosoftChanged(callback: () => void): () => void
  dialog: {
    pickFolder(): Promise<string | null>
  }
  shell: {
    openPath(filePath: string): Promise<string>
    showItemInFolder(filePath: string): Promise<void>
  }
  bugReport: {
    submit(data: {
      name?: string
      email?: string
      description: string
    }): Promise<{ success: boolean; issue_url?: string; error?: string }>
  }
  workspaceFiles: {
    list(workspaceId: string): Promise<WorkspaceFile[]>
    add(data: {
      workspace_id: string
      file_path: string
      file_name: string
    }): Promise<WorkspaceFile>
    remove(id: string): Promise<void>
    pick(): Promise<string[]>
    resolvePaths(paths: string[]): Promise<string[]>
  }
  onWorkspaceFilesChanged(callback: () => void): () => void
  conversations: {
    list(workspaceId: string): Promise<Conversation[]>
    get(id: string): Promise<Conversation | undefined>
    create(data: { workspace_id: string; title?: string }): Promise<Conversation>
    updateTitle(id: string, title: string): Promise<Conversation>
    delete(id: string): Promise<void>
    count(workspaceId: string): Promise<number>
    listMessages(conversationId: string): Promise<ConversationMessage[]>
    addMessage(data: {
      conversation_id: string
      role: 'user' | 'assistant'
      content: string
      thinking?: string
      tool_name?: string
      tool_args?: string
      tool_call_id?: string
      tool_result?: string
      tool_is_error?: boolean
      patch_log_id?: string
      patch_diff?: string
      patch_document_id?: string
      images?: string
      files?: string
    }): Promise<ConversationMessage>
    updateMessage(
      id: string,
      data: {
        content?: string
        thinking?: string
        tool_result?: string
        tool_is_error?: boolean
      }
    ): Promise<void>
  }
  onConversationsChanged(callback: () => void): () => void
  getPathForFile(file: File): string
  images: {
    save(filePath: string): Promise<string>
    saveFromBuffer(buffer: Uint8Array, ext: string): Promise<string>
    pick(): Promise<string | null>
    readBase64(filePath: string): Promise<{ data: string; mimeType: string }>
  }
  files: {
    pickForChat(): Promise<string[]>
  }
  scheduler: {
    list(workspaceId: string): Promise<unknown[]>
    get(id: string): Promise<unknown>
    toggle(id: string, enabled: boolean): Promise<void>
    update(
      id: string,
      changes: { name?: string; prompt?: string; cron_expression?: string }
    ): Promise<void>
    delete(id: string): Promise<void>
    runNow(id: string): Promise<void>
  }
  onSchedulerChanged(callback: () => void): () => void
  onTaskRunning(callback: (data: { taskId: string; running: boolean }) => void): () => void
  onTaskCompleted(
    callback: (data: { taskId: string; name: string; status: string; error?: string }) => void
  ): () => void
  theme: {
    get(): Promise<ThemeData>
    save(data: Partial<ThemeData>): Promise<void>
  }
  onThemeChanged(callback: (data: ThemeData) => void): () => void
  app: {
    getVersion(): Promise<string>
    getUpdateStatus(): Promise<UpdateStatus>
    checkForUpdates(): Promise<void>
    downloadUpdate(): Promise<void>
    quitAndInstall(): Promise<void>
    checkPython(): Promise<{ installed: boolean; version?: string; bundled: boolean }>
    onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: GreenteaApi
  }
}
