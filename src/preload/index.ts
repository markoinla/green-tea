import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const greenteaApi = {
  // Raw artifact text by document id, for read-only viewers (e.g. the CSV viewer)
  // that cannot fetch gt-file:// because the renderer CSP blocks connect-src for it.
  readArtifactText: (id: string): Promise<string> =>
    ipcRenderer.invoke('documents:readArtifact', id),
  // Write-back for an editable artifact (the canvas autosaves through this).
  writeArtifact: (id: string, contents: string): Promise<void> =>
    ipcRenderer.invoke('documents:writeArtifact', id, contents),
  workspaces: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('db:workspaces:list'),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('db:workspaces:get', id),
    create: (data: { name: string; path?: string; mode?: 'new' | 'open' }): Promise<unknown> =>
      ipcRenderer.invoke('db:workspaces:create', data),
    update: (id: string, data: { name?: string; description?: string }): Promise<unknown> =>
      ipcRenderer.invoke('db:workspaces:update', id, data),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('db:workspaces:delete', id),
    // Folder moved/deleted out from under a workspace — repoint to a new path.
    relocate: (id: string, newPath: string): Promise<unknown> =>
      ipcRenderer.invoke('db:workspaces:relocate', id, newPath),
    // Which workspaces' folders still exist on disk (the "unavailable" check).
    availability: (): Promise<{ id: string; path: string; available: boolean }[]> =>
      ipcRenderer.invoke('db:workspaces:availability')
  },
  documents: {
    list: (workspaceId?: string): Promise<unknown[]> =>
      ipcRenderer.invoke('db:documents:list', workspaceId),
    reindex: (workspaceId: string): Promise<void> =>
      ipcRenderer.invoke('db:documents:reindex', workspaceId),
    search: (query: string): Promise<unknown[]> => ipcRenderer.invoke('db:documents:search', query),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('db:documents:get', id),
    backlinks: (id: string): Promise<unknown[]> => ipcRenderer.invoke('db:documents:backlinks', id),
    outgoingLinks: (id: string): Promise<unknown[]> =>
      ipcRenderer.invoke('db:documents:outgoingLinks', id),
    create: (data: {
      title: string
      workspace_id?: string
      content?: string
      folder_id?: string | null
    }): Promise<unknown> => ipcRenderer.invoke('db:documents:create', data),
    createArtifact: (data: {
      title: string
      kind: string
      workspace_id?: string
      folder_id?: string | null
    }): Promise<unknown> => ipcRenderer.invoke('db:documents:createArtifact', data),
    update: (
      id: string,
      data: { title?: string; workspace_id?: string; content?: string; folder_id?: string | null }
    ): Promise<unknown> => ipcRenderer.invoke('db:documents:update', id, data),
    updateFrontmatter: (id: string, changedKeys: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke('db:documents:updateFrontmatter', id, changedKeys),
    patchHtmlText: (
      id: string,
      patch: { path: number[]; oldText: string; newHTML: string }
    ): Promise<void> => ipcRenderer.invoke('db:documents:patchHtmlText', id, patch),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('db:documents:delete', id)
  },
  metadata: {
    getTypes: (workspaceId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('db:metadata:getTypes', workspaceId),
    setType: (workspaceId: string, key: string, type: string): Promise<void> =>
      ipcRenderer.invoke('db:metadata:setType', workspaceId, key, type),
    tagSuggest: (workspaceId: string, prefix?: string): Promise<string[]> =>
      ipcRenderer.invoke('db:metadata:tagSuggest', workspaceId, prefix),
    nameSuggest: (workspaceId: string, prefix?: string): Promise<string[]> =>
      ipcRenderer.invoke('db:metadata:nameSuggest', workspaceId, prefix),
    listByProperty: (workspaceId: string, key: string, valueFold: string): Promise<unknown[]> =>
      ipcRenderer.invoke('db:metadata:listByProperty', workspaceId, key, valueFold)
  },
  folders: {
    list: (workspaceId?: string): Promise<unknown[]> =>
      ipcRenderer.invoke('db:folders:list', workspaceId),
    create: (data: { name: string; workspace_id?: string }): Promise<unknown> =>
      ipcRenderer.invoke('db:folders:create', data),
    update: (id: string, data: { name?: string; collapsed?: number }): Promise<unknown> =>
      ipcRenderer.invoke('db:folders:update', id, data),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('db:folders:delete', id)
  },
  blocks: {
    getTree: (documentId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('db:blocks:get-tree', documentId),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('db:blocks:get', id),
    create: (data: {
      document_id: string
      parent_block_id?: string
      type?: string
      content?: string
      position?: number
    }): Promise<unknown> => ipcRenderer.invoke('db:blocks:create', data),
    update: (
      id: string,
      data: { type?: string; content?: string; collapsed?: number; position?: number }
    ): Promise<unknown> => ipcRenderer.invoke('db:blocks:update', id, data),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('db:blocks:delete', id),
    move: (id: string, data: { parent_block_id?: string; position: number }): Promise<void> =>
      ipcRenderer.invoke('db:blocks:move', id, data)
  },
  markdown: {
    serialize: (documentId: string): Promise<string> =>
      ipcRenderer.invoke('md:serialize', documentId),
    deserialize: (markdown: string): Promise<unknown[]> =>
      ipcRenderer.invoke('md:deserialize', markdown)
  },
  agent: {
    prompt: (data: {
      message: string
      conversationId: string
      documentId?: string
      workspaceId?: string
      references?: { id: string; title: string }[]
      images?: { data: string; mimeType: string }[]
      files?: { name: string; path: string }[]
    }): Promise<void> => ipcRenderer.invoke('agent:prompt', data),
    abort: (conversationId: string): Promise<void> =>
      ipcRenderer.invoke('agent:abort', conversationId),
    resetSession: (conversationId?: string): Promise<void> =>
      ipcRenderer.invoke('agent:reset-session', conversationId),
    approveEdit: (logId: string): Promise<void> => ipcRenderer.invoke('agent:approve-edit', logId),
    rejectEdit: (logId: string): Promise<void> => ipcRenderer.invoke('agent:reject-edit', logId),
    approveMetadata: (logId: string): Promise<{ documentIds: string[]; rejectedKeys: string[] }> =>
      ipcRenderer.invoke('agent:approve-metadata', logId),
    rejectMetadata: (logId: string): Promise<void> =>
      ipcRenderer.invoke('agent:reject-metadata', logId),
    generateTitle: (data: { conversationId: string; userMessage: string }): Promise<void> =>
      ipcRenderer.invoke('agent:generate-title', data),
    onEvent: (callback: (data: unknown) => void): (() => void) => {
      const sub = (_event: unknown, data: unknown): void => callback(data)
      ipcRenderer.on('agent:event', sub)
      return () => {
        ipcRenderer.removeListener('agent:event', sub)
      }
    },
    onSubagentEvent: (callback: (data: unknown) => void): (() => void) => {
      const sub = (_event: unknown, data: unknown): void => callback(data)
      ipcRenderer.on('agent:subagent-event', sub)
      return () => {
        ipcRenderer.removeListener('agent:subagent-event', sub)
      }
    }
  },
  documentVersions: {
    list: (documentId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('db:document-versions:list', documentId),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('db:document-versions:get', id),
    create: (data: {
      document_id: string
      title: string
      content: string | null
    }): Promise<unknown> => ipcRenderer.invoke('db:document-versions:create', data),
    restore: (id: string): Promise<unknown> =>
      ipcRenderer.invoke('db:document-versions:restore', id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('db:document-versions:delete', id)
  },
  onDocumentVersionsChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('document-versions:changed', sub)
    return () => {
      ipcRenderer.removeListener('document-versions:changed', sub)
    }
  },
  onDocumentsChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('documents:changed', sub)
    return () => {
      ipcRenderer.removeListener('documents:changed', sub)
    }
  },
  onDocumentContentChanged: (callback: (data: { id: string }) => void): (() => void) => {
    const sub = (_event: unknown, data: { id: string }): void => callback(data)
    ipcRenderer.on('documents:content-changed', sub)
    return () => {
      ipcRenderer.removeListener('documents:content-changed', sub)
    }
  },
  onFoldersChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('folders:changed', sub)
    return () => {
      ipcRenderer.removeListener('folders:changed', sub)
    }
  },
  onWorkspacesChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('workspaces:changed', sub)
    return () => {
      ipcRenderer.removeListener('workspaces:changed', sub)
    }
  },
  settings: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('db:settings:get', key),
    set: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke('db:settings:set', key, value),
    getAll: (): Promise<Record<string, string>> => ipcRenderer.invoke('db:settings:get-all'),
    testApiKey: (provider: string, apiKey: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('db:settings:test-api-key', provider, apiKey)
  },
  onSettingsChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('settings:changed', sub)
    return () => {
      ipcRenderer.removeListener('settings:changed', sub)
    }
  },
  tabs: {
    get: (
      workspaceId: string
    ): Promise<{ openDocIds: string[]; activeDocId: string | null } | null> =>
      ipcRenderer.invoke('tabs:get', workspaceId),
    set: (
      workspaceId: string,
      state: { openDocIds: string[]; activeDocId: string | null }
    ): Promise<void> => ipcRenderer.invoke('tabs:set', workspaceId, state)
  },
  menu: {
    onTabCommand: (
      callback: (cmd: { type: 'close' | 'next' | 'prev' } | { type: 'goto'; index: number }) => void
    ): (() => void) => {
      const sub = (
        _event: unknown,
        cmd: { type: 'close' | 'next' | 'prev' } | { type: 'goto'; index: number }
      ): void => callback(cmd)
      ipcRenderer.on('menu:tab-command', sub)
      return () => {
        ipcRenderer.removeListener('menu:tab-command', sub)
      }
    }
  },
  agentLogs: {
    list: (filter?: { document_id?: string; status?: string }): Promise<unknown[]> =>
      ipcRenderer.invoke('db:agent-logs:list', filter)
  },
  skills: {
    list: (): Promise<{ name: string; description: string; enabled: boolean }[]> =>
      ipcRenderer.invoke('skills:list'),
    install: (url: string): Promise<{ name: string; description: string; enabled: boolean }> =>
      ipcRenderer.invoke('skills:install', url),
    remove: (name: string): Promise<void> => ipcRenderer.invoke('skills:remove', name),
    toggle: (name: string, enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('skills:toggle', name, enabled),
    marketplaceList: (): Promise<
      { name: string; description: string; author: string; version: string; path: string }[]
    > => ipcRenderer.invoke('skills:marketplace:list'),
    marketplaceRefresh: (): Promise<
      { name: string; description: string; author: string; version: string; path: string }[]
    > => ipcRenderer.invoke('skills:marketplace:refresh')
  },
  onSkillsChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('skills:changed', sub)
    return () => {
      ipcRenderer.removeListener('skills:changed', sub)
    }
  },
  plugins: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('plugins:list'),
    install: (url: string): Promise<unknown> => ipcRenderer.invoke('plugins:install', url),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('plugins:remove', id),
    toggle: (id: string, enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('plugins:toggle', id, enabled),
    marketplaceList: (): Promise<unknown[]> => ipcRenderer.invoke('plugins:marketplace:list'),
    marketplaceRefresh: (): Promise<unknown[]> => ipcRenderer.invoke('plugins:marketplace:refresh'),
    viewers: (): Promise<unknown[]> => ipcRenderer.invoke('plugins:viewers')
  },
  onPluginsChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('plugins:changed', sub)
    return () => {
      ipcRenderer.removeListener('plugins:changed', sub)
    }
  },
  mcp: {
    getConfig: (): Promise<unknown> => ipcRenderer.invoke('mcp:get-config'),
    saveConfig: (config: unknown): Promise<void> => ipcRenderer.invoke('mcp:save-config', config),
    getStatuses: (): Promise<unknown[]> => ipcRenderer.invoke('mcp:get-statuses'),
    testConnection: (
      name: string
    ): Promise<{ success: boolean; toolCount?: number; error?: string }> =>
      ipcRenderer.invoke('mcp:test-connection', name),
    disconnect: (name: string): Promise<void> => ipcRenderer.invoke('mcp:disconnect', name),
    authenticate: (name: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('mcp:authenticate', name),
    clearAuth: (name: string): Promise<void> => ipcRenderer.invoke('mcp:clear-auth', name)
  },
  onMcpChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('mcp:changed', sub)
    return () => {
      ipcRenderer.removeListener('mcp:changed', sub)
    }
  },
  google: {
    connectService: (service: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('google:connect-service', service),
    disconnectService: (service: string): Promise<void> =>
      ipcRenderer.invoke('google:disconnect-service', service),
    clearAuth: (): Promise<void> => ipcRenderer.invoke('google:clear-auth'),
    getStatus: (): Promise<{
      authenticated: boolean
      email?: string
      scopes: string[]
      enabledServices: string[]
    }> => ipcRenderer.invoke('google:get-status')
  },
  onGoogleChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('google:changed', sub)
    return () => {
      ipcRenderer.removeListener('google:changed', sub)
    }
  },
  microsoft: {
    connectService: (service: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('microsoft:connect-service', service),
    disconnectService: (service: string): Promise<void> =>
      ipcRenderer.invoke('microsoft:disconnect-service', service),
    clearAuth: (): Promise<void> => ipcRenderer.invoke('microsoft:clear-auth'),
    getStatus: (): Promise<{
      authenticated: boolean
      email?: string
      displayName?: string
      scopes: string[]
      enabledServices: string[]
    }> => ipcRenderer.invoke('microsoft:get-status')
  },
  onMicrosoftChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('microsoft:changed', sub)
    return () => {
      ipcRenderer.removeListener('microsoft:changed', sub)
    }
  },
  dialog: {
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-folder')
  },
  shell: {
    openPath: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('shell:open-path', filePath),
    showItemInFolder: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('shell:show-item-in-folder', filePath),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url)
  },
  export: {
    pdf: (args: {
      markdown: string
      title: string
    }): Promise<{ saved: boolean; filePath?: string }> => ipcRenderer.invoke('export:pdf', args)
  },
  bugReport: {
    submit: (data: {
      name?: string
      email?: string
      description: string
    }): Promise<{ success: boolean; issue_url?: string; error?: string }> =>
      ipcRenderer.invoke('bug-report:submit', data)
  },
  share: {
    publish: (documentId: string): Promise<{ url: string; slug: string; expiresAt: string }> =>
      ipcRenderer.invoke('share:publish', documentId),
    // Canvas: the renderer prerenders the scene to a static HTML/SVG page and
    // passes it here (exportToSvg needs a DOM the main process doesn't have).
    publishCanvas: (
      documentId: string,
      entryHtml: string
    ): Promise<{ url: string; slug: string; expiresAt: string }> =>
      ipcRenderer.invoke('share:publishCanvas', documentId, entryHtml),
    unpublish: (documentId: string): Promise<void> =>
      ipcRenderer.invoke('share:unpublish', documentId),
    status: (
      documentId: string
    ): Promise<{ shared: boolean; url?: string; slug?: string; expiresAt?: string }> =>
      ipcRenderer.invoke('share:status', documentId)
  },
  workspaceFiles: {
    list: (workspaceId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('db:workspace-files:list', workspaceId),
    add: (data: { workspace_id: string; file_path: string; file_name: string }): Promise<unknown> =>
      ipcRenderer.invoke('db:workspace-files:add', data),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('db:workspace-files:remove', id),
    pick: (): Promise<string[]> => ipcRenderer.invoke('db:workspace-files:pick'),
    resolvePaths: (paths: string[]): Promise<string[]> =>
      ipcRenderer.invoke('db:workspace-files:resolve-paths', paths)
  },
  onWorkspaceFilesChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('workspace-files:changed', sub)
    return () => {
      ipcRenderer.removeListener('workspace-files:changed', sub)
    }
  },
  conversations: {
    list: (workspaceId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('db:conversations:list', workspaceId),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('db:conversations:get', id),
    create: (data: { workspace_id: string; title?: string }): Promise<unknown> =>
      ipcRenderer.invoke('db:conversations:create', data),
    updateTitle: (id: string, title: string): Promise<unknown> =>
      ipcRenderer.invoke('db:conversations:update-title', id, title),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('db:conversations:delete', id),
    count: (workspaceId: string): Promise<number> =>
      ipcRenderer.invoke('db:conversations:count', workspaceId),
    listMessages: (conversationId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('db:conversation-messages:list', conversationId),
    addMessage: (data: {
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
      metadata_log_id?: string
      metadata_payload?: string
      images?: string
      files?: string
    }): Promise<unknown> => ipcRenderer.invoke('db:conversation-messages:add', data),
    updateMessage: (
      id: string,
      data: {
        content?: string
        thinking?: string
        tool_result?: string
        tool_is_error?: boolean
      }
    ): Promise<void> => ipcRenderer.invoke('db:conversation-messages:update', id, data)
  },
  onConversationsChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('conversations:changed', sub)
    return () => {
      ipcRenderer.removeListener('conversations:changed', sub)
    }
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  images: {
    save: (filePath: string): Promise<string> => ipcRenderer.invoke('images:save', filePath),
    saveFromBuffer: (buffer: Uint8Array, ext: string): Promise<string> =>
      ipcRenderer.invoke('images:save-from-buffer', buffer, ext),
    pick: (): Promise<string | null> => ipcRenderer.invoke('images:pick'),
    readBase64: (filePath: string): Promise<{ data: string; mimeType: string }> =>
      ipcRenderer.invoke('images:read-base64', filePath)
  },
  files: {
    pickForChat: (): Promise<string[]> => ipcRenderer.invoke('files:pick-for-chat')
  },
  scheduler: {
    list: (workspaceId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('scheduler:list', workspaceId),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('scheduler:get', id),
    toggle: (id: string, enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('scheduler:toggle', id, enabled),
    update: (
      id: string,
      changes: { name?: string; prompt?: string; cron_expression?: string }
    ): Promise<void> => ipcRenderer.invoke('scheduler:update', id, changes),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('scheduler:delete', id),
    runNow: (id: string): Promise<void> => ipcRenderer.invoke('scheduler:run-now', id)
  },
  onSchedulerChanged: (callback: () => void): (() => void) => {
    const sub = (): void => callback()
    ipcRenderer.on('scheduler:changed', sub)
    return () => {
      ipcRenderer.removeListener('scheduler:changed', sub)
    }
  },
  onTaskRunning: (callback: (data: { taskId: string; running: boolean }) => void): (() => void) => {
    const sub = (_event: unknown, data: { taskId: string; running: boolean }): void =>
      callback(data)
    ipcRenderer.on('scheduler:task-running', sub)
    return () => {
      ipcRenderer.removeListener('scheduler:task-running', sub)
    }
  },
  onTaskCompleted: (
    callback: (data: { taskId: string; name: string; status: string; error?: string }) => void
  ): (() => void) => {
    const sub = (
      _event: unknown,
      data: { taskId: string; name: string; status: string; error?: string }
    ): void => callback(data)
    ipcRenderer.on('scheduler:task-completed', sub)
    return () => {
      ipcRenderer.removeListener('scheduler:task-completed', sub)
    }
  },
  onSchedulerOpenRun: (callback: (data: { taskId: string }) => void): (() => void) => {
    const sub = (_event: unknown, data: { taskId: string }): void => callback(data)
    ipcRenderer.on('scheduler:open-run', sub)
    return () => {
      ipcRenderer.removeListener('scheduler:open-run', sub)
    }
  },
  theme: {
    get: (): Promise<unknown> => ipcRenderer.invoke('theme:get'),
    save: (data: Record<string, unknown>): Promise<void> => ipcRenderer.invoke('theme:save', data)
  },
  onThemeChanged: (callback: (data: unknown) => void): (() => void) => {
    const sub = (_event: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('theme:changed', sub)
    return () => {
      ipcRenderer.removeListener('theme:changed', sub)
    }
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
    getUpdateStatus: (): Promise<unknown> => ipcRenderer.invoke('app:update-status'),
    checkForUpdates: (): Promise<void> => ipcRenderer.invoke('app:check-for-updates'),
    downloadUpdate: (): Promise<void> => ipcRenderer.invoke('app:download-update'),
    quitAndInstall: (): Promise<void> => ipcRenderer.invoke('app:quit-and-install'),
    checkPython: (): Promise<{ installed: boolean; version?: string; bundled: boolean }> =>
      ipcRenderer.invoke('app:check-python'),
    onUpdateStatus: (callback: (status: unknown) => void): (() => void) => {
      const sub = (_event: unknown, status: unknown): void => callback(status)
      ipcRenderer.on('app:update-status', sub)
      return () => {
        ipcRenderer.removeListener('app:update-status', sub)
      }
    },
    onFlushBeforeQuit: (callback: () => void): (() => void) => {
      const sub = (): void => callback()
      ipcRenderer.on('app:flush-before-quit', sub)
      return () => {
        ipcRenderer.removeListener('app:flush-before-quit', sub)
      }
    },
    flushDone: (): void => ipcRenderer.send('app:flush-done')
  }
}

// contextIsolation is pinned to true in the main process webPreferences, so the
// context bridge is the only supported path. If a future regression turns
// contextIsolation off, exposeInMainWorld throws and the preload fails loudly
// rather than silently falling back to an insecure global assignment.
if (!process.contextIsolated) {
  throw new Error(
    'Preload requires contextIsolation:true. Refusing to expose window.api without the context bridge.'
  )
}

try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', greenteaApi)
} catch (error) {
  console.error(error)
}
