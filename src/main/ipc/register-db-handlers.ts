import { ipcMain } from 'electron'
import { renameSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import * as blocks from '../database/repositories/blocks'
import * as agentLogs from '../database/repositories/agent-logs'
import * as folders from '../database/repositories/folders'
import * as workspaces from '../database/repositories/workspaces'
import * as settings from '../database/repositories/settings'
import * as conversations from '../database/repositories/conversations'
import * as documentVersions from '../database/repositories/document-versions'
import * as documents from '../vault/documents-service'
import { getWorkspaceVaultDir, ensureVaultDir } from '../vault/paths'
import type { BlockNode } from '../database/types'
import type { SerializableBlock } from '../markdown/types'
import { serializeBlocks } from '../markdown/serialize'
import { deserializeMarkdown } from '../markdown/deserialize'
import { restartThemeWatcher } from '../theme-watcher'
import { restartVaultWatcher } from '../vault/vault-watcher'
import { resetSession } from '../agent/session'
import { getWorkspacesRoot, sanitizeWorkspaceName } from '../agent/paths'
import type { IpcHandlerContext } from './context'

function blockNodeToSerializable(node: BlockNode): SerializableBlock {
  const block: SerializableBlock = {
    id: node.id,
    type: node.type as SerializableBlock['type'],
    content: node.content,
    isList: true,
    children: node.children.map(blockNodeToSerializable)
  }
  if (node.type === 'task_item') {
    // The collapsed field is repurposed to store checked state for task items
    block.checked = node.collapsed === 1
  }
  return block
}

export function registerDbHandlers({ db, mainWindow }: IpcHandlerContext): void {
  // Workspaces
  ipcMain.handle('db:workspaces:list', () => {
    return workspaces.listWorkspaces(db)
  })

  ipcMain.handle('db:workspaces:get', (_event, id: string) => {
    return workspaces.getWorkspace(db, id)
  })

  ipcMain.handle('db:workspaces:create', (_event, data: { name: string }) => {
    const workspace = workspaces.createWorkspace(db, data)
    // One folder per workspace: the durable notes vault, also the agent's home.
    ensureVaultDir(getWorkspaceVaultDir(db, workspace.id))
    mainWindow?.webContents.send('workspaces:changed')
    return workspace
  })

  ipcMain.handle(
    'db:workspaces:update',
    (_event, id: string, data: { name?: string; description?: string }) => {
      if (data.name) {
        const oldWorkspace = workspaces.getWorkspace(db, id)
        if (oldWorkspace && data.name !== oldWorkspace.name) {
          // Rename the single workspace folder; notes and agent scratch move with it.
          const root = getWorkspacesRoot(db)
          const oldDir = join(root, sanitizeWorkspaceName(oldWorkspace.name))
          const newDir = join(root, sanitizeWorkspaceName(data.name))
          if (existsSync(oldDir) && !existsSync(newDir)) renameSync(oldDir, newDir)
        }
      }
      const workspace = workspaces.updateWorkspace(db, id, data)
      // File paths in the index moved with the vault dir — rebuild from disk.
      documents.reindexWorkspace(db, id)
      mainWindow?.webContents.send('workspaces:changed')
      mainWindow?.webContents.send('documents:changed')
      return workspace
    }
  )

  ipcMain.handle('db:workspaces:delete', (_event, id: string) => {
    const vaultDir = getWorkspaceVaultDir(db, id)
    workspaces.deleteWorkspace(db, id)
    if (existsSync(vaultDir)) rmSync(vaultDir, { recursive: true, force: true })
    mainWindow?.webContents.send('workspaces:changed')
    mainWindow?.webContents.send('documents:changed')
    mainWindow?.webContents.send('folders:changed')
  })

  // Documents
  ipcMain.handle('db:documents:list', (_event, workspaceId?: string) => {
    return documents.listDocuments(db, workspaceId)
  })

  ipcMain.handle('db:documents:search', (_event, query: string) => {
    return documents.searchDocuments(db, query)
  })

  ipcMain.handle('db:documents:get', (_event, id: string) => {
    return documents.getDocument(db, id)
  })

  ipcMain.handle(
    'db:documents:create',
    (
      _event,
      data: { title: string; workspace_id?: string; content?: string; folder_id?: string | null }
    ) => {
      const doc = documents.createDocument(db, data)
      mainWindow?.webContents.send('documents:changed')
      return doc
    }
  )

  ipcMain.handle(
    'db:documents:update',
    (
      _event,
      id: string,
      data: { title?: string; workspace_id?: string; content?: string; folder_id?: string | null }
    ) => {
      const doc = documents.updateDocument(db, id, data)
      const isContentOnly =
        data.content !== undefined &&
        data.title === undefined &&
        data.workspace_id === undefined &&
        data.folder_id === undefined
      // Content-only autosaves are NOT echoed back to the renderer: the editor
      // already holds this content, and re-broadcasting it forced a fragile
      // "is this my own echo?" guard. The vault watcher is the single source of
      // external content-change notifications (it drops the app's own writes via
      // a content-hash registry). Structural edits still refresh the sidebar.
      if (!isContentOnly) {
        mainWindow?.webContents.send('documents:changed')
      }
      return doc
    }
  )

  ipcMain.handle('db:documents:delete', (_event, id: string) => {
    documents.deleteDocument(db, id)
    mainWindow?.webContents.send('documents:changed')
  })

  // Field-merge frontmatter write (the single reserved-key chokepoint). The
  // renderer never writes whole-blob frontmatter; it sends only changed keys.
  ipcMain.handle(
    'db:documents:updateFrontmatter',
    (_event, id: string, changedKeys: Record<string, unknown>) => {
      const result = documents.updateFrontmatter(db, id, changedKeys)
      mainWindow?.webContents.send('documents:changed')
      return result
    }
  )

  // Per-workspace property type registry.
  ipcMain.handle('db:metadata:getTypes', (_event, workspaceId: string) => {
    return documents.getPropertyTypes(db, workspaceId)
  })

  ipcMain.handle(
    'db:metadata:setType',
    (_event, workspaceId: string, key: string, type: string) => {
      documents.setPropertyType(db, workspaceId, key, type as documents.PropertyTypeEntry['type'])
      mainWindow?.webContents.send('documents:changed')
    }
  )

  // Tag autocomplete for the Properties chip input — the workspace-global tag set
  // (deterministic display per fold group, §4.2).
  ipcMain.handle('db:metadata:tagSuggest', (_event, workspaceId: string, prefix?: string) => {
    return documents.tagSuggest(db, workspaceId, prefix ?? '')
  })

  // Existing property names for "+ Add property" name autocomplete.
  ipcMain.handle('db:metadata:nameSuggest', (_event, workspaceId: string, prefix?: string) => {
    return documents.propertyNameSuggest(db, workspaceId, prefix ?? '')
  })

  // Human retrieval (Phase 4): notes in the workspace whose property `key` equals
  // `valueFold` (case-insensitive, NFC-folded). Returns the same Document[] shape
  // the left-sidebar list already renders — no new view system.
  ipcMain.handle(
    'db:metadata:listByProperty',
    (_event, workspaceId: string, key: string, valueFold: string) => {
      return documents.listByProperty(db, workspaceId, key, valueFold)
    }
  )

  // Document Versions
  ipcMain.handle('db:document-versions:list', (_event, documentId: string) => {
    return documentVersions.listVersions(db, documentId)
  })

  ipcMain.handle('db:document-versions:get', (_event, id: string) => {
    return documentVersions.getVersion(db, id)
  })

  ipcMain.handle(
    'db:document-versions:create',
    (_event, data: { document_id: string; title: string; content: string | null }) => {
      const version = documentVersions.createVersion(db, { ...data, source: 'manual' })
      mainWindow?.webContents.send('document-versions:changed')
      return version
    }
  )

  ipcMain.handle('db:document-versions:restore', (_event, id: string) => {
    const version = documentVersions.getVersion(db, id)
    if (version) {
      const current = documents.getDocument(db, version.document_id)
      if (current) {
        // Snapshot current state, then restore via the file-backed service.
        documentVersions.createVersion(db, {
          document_id: current.id,
          title: current.title,
          content: current.content,
          source: 'restore'
        })
        documents.updateDocument(db, version.document_id, {
          title: version.title,
          content: version.content ?? undefined
        })
      }
    }
    mainWindow?.webContents.send('documents:content-changed', { id: version?.document_id })
    mainWindow?.webContents.send('documents:changed')
    mainWindow?.webContents.send('document-versions:changed')
  })

  ipcMain.handle('db:document-versions:delete', (_event, id: string) => {
    documentVersions.deleteVersion(db, id)
    mainWindow?.webContents.send('document-versions:changed')
  })

  // Folders
  ipcMain.handle('db:folders:list', (_event, workspaceId?: string) => {
    return folders.listFolders(db, workspaceId)
  })

  ipcMain.handle('db:folders:create', (_event, data: { name: string; workspace_id?: string }) => {
    if (!data.workspace_id) throw new Error('workspace_id is required to create a folder')
    const folder = documents.createFolder(db, { name: data.name, workspace_id: data.workspace_id })
    mainWindow?.webContents.send('folders:changed')
    return folders.getFolder(db, folder.id)
  })

  ipcMain.handle(
    'db:folders:update',
    (_event, id: string, data: { name?: string; collapsed?: number }) => {
      // Renaming a folder renames its subdirectory (and moves its notes).
      if (data.name !== undefined) documents.renameFolder(db, id, data.name)
      const folder = folders.updateFolder(db, id, data)
      mainWindow?.webContents.send('folders:changed')
      mainWindow?.webContents.send('documents:changed')
      return folder
    }
  )

  ipcMain.handle('db:folders:delete', (_event, id: string) => {
    documents.deleteFolder(db, id)
    mainWindow?.webContents.send('folders:changed')
    mainWindow?.webContents.send('documents:changed')
  })

  // Blocks
  ipcMain.handle('db:blocks:get-tree', (_event, documentId: string) => {
    return blocks.getBlockTree(db, documentId)
  })

  ipcMain.handle('db:blocks:get', (_event, id: string) => {
    return blocks.getBlock(db, id)
  })

  ipcMain.handle(
    'db:blocks:create',
    (
      _event,
      data: {
        document_id: string
        parent_block_id?: string
        type?: string
        content?: string
        position?: number
      }
    ) => {
      return blocks.createBlock(db, data)
    }
  )

  ipcMain.handle(
    'db:blocks:update',
    (
      _event,
      id: string,
      data: { type?: string; content?: string; collapsed?: number; position?: number }
    ) => {
      return blocks.updateBlock(db, id, data)
    }
  )

  ipcMain.handle('db:blocks:delete', (_event, id: string) => {
    return blocks.deleteBlock(db, id)
  })

  ipcMain.handle(
    'db:blocks:move',
    (_event, id: string, data: { parent_block_id?: string; position: number }) => {
      return blocks.moveBlock(db, id, data)
    }
  )

  // Markdown
  ipcMain.handle('md:serialize', (_event, documentId: string) => {
    const tree = blocks.getBlockTree(db, documentId)
    const serializableBlocks = tree.map(blockNodeToSerializable)
    return serializeBlocks(serializableBlocks)
  })

  ipcMain.handle('md:deserialize', (_event, markdown: string) => {
    return deserializeMarkdown(markdown)
  })

  // Settings
  ipcMain.handle('db:settings:get', (_event, key: string) => {
    return settings.getSetting(db, key)
  })

  ipcMain.handle('db:settings:set', (_event, key: string, value: string) => {
    settings.setSetting(db, key, value)
    mainWindow?.webContents.send('settings:changed')
    if (key === 'agentBaseDir') {
      restartThemeWatcher()
      restartVaultWatcher()
    }
  })

  ipcMain.handle('db:settings:get-all', () => {
    return settings.getAllSettings(db)
  })

  // Open-tab state — stored as a settings row (key `openTabs:${workspaceId}`) but
  // on a DEDICATED channel that does NOT broadcast `settings:changed`. Routing it
  // through `db:settings:set` would re-trigger a full theme reload on every
  // debounced, per-keystroke tab write.
  ipcMain.handle('tabs:get', (_event, workspaceId: string) => {
    const raw = settings.getSetting(db, `openTabs:${workspaceId}`)
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'tabs:set',
    (_event, workspaceId: string, state: { openDocIds: string[]; activeDocId: string | null }) => {
      settings.setSetting(db, `openTabs:${workspaceId}`, JSON.stringify(state))
    }
  )

  ipcMain.handle(
    'db:settings:test-api-key',
    async (
      _event,
      provider: string,
      apiKey: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!apiKey) return { success: false, error: 'No API key provided' }

      const endpoints: Record<string, { url: string; header: string }> = {
        anthropic: {
          url: 'https://api.anthropic.com/v1/models',
          header: 'x-api-key'
        },
        together: {
          url: 'https://api.together.xyz/v1/models?limit=1',
          header: 'Authorization'
        },
        openrouter: {
          url: 'https://openrouter.ai/api/v1/models?limit=1',
          header: 'Authorization'
        },
        zenlayer: {
          url: 'https://gateway.theturbo.ai/v1/models',
          header: 'Authorization'
        }
      }

      const config = endpoints[provider]
      if (!config) return { success: false, error: `Unknown provider: ${provider}` }

      try {
        const headers: Record<string, string> = {}
        if (config.header === 'x-api-key') {
          headers['x-api-key'] = apiKey
          headers['anthropic-version'] = '2023-06-01'
        } else {
          headers['Authorization'] = `Bearer ${apiKey}`
        }

        const res = await fetch(config.url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(10000)
        })

        if (res.ok) return { success: true }
        if (res.status === 401 || res.status === 403) {
          return { success: false, error: 'Invalid API key' }
        }
        return { success: false, error: `API returned status ${res.status}` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    }
  )

  // Agent logs
  ipcMain.handle(
    'db:agent-logs:list',
    (_event, filter?: { document_id?: string; status?: string }) => {
      return agentLogs.listAgentLogs(db, filter)
    }
  )

  // Conversations
  ipcMain.handle('db:conversations:list', (_event, workspaceId: string) => {
    return conversations.listConversations(db, workspaceId)
  })

  ipcMain.handle('db:conversations:get', (_event, id: string) => {
    return conversations.getConversation(db, id)
  })

  ipcMain.handle(
    'db:conversations:create',
    (_event, data: { workspace_id: string; title?: string }) => {
      const count = conversations.countConversations(db, data.workspace_id)
      if (count >= 3) throw new Error('Maximum of 3 conversations per workspace')
      const conversation = conversations.createConversation(db, data)
      mainWindow?.webContents.send('conversations:changed')
      return conversation
    }
  )

  ipcMain.handle('db:conversations:update-title', (_event, id: string, title: string) => {
    const conversation = conversations.updateConversationTitle(db, id, title)
    mainWindow?.webContents.send('conversations:changed')
    return conversation
  })

  ipcMain.handle('db:conversations:delete', async (_event, id: string) => {
    await resetSession(id)
    conversations.deleteConversation(db, id)
    mainWindow?.webContents.send('conversations:changed')
  })

  ipcMain.handle('db:conversations:count', (_event, workspaceId: string) => {
    return conversations.countConversations(db, workspaceId)
  })

  ipcMain.handle('db:conversation-messages:list', (_event, conversationId: string) => {
    return conversations.listConversationMessages(db, conversationId)
  })

  ipcMain.handle(
    'db:conversation-messages:add',
    (
      _event,
      data: {
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
      }
    ) => {
      return conversations.addConversationMessage(db, data)
    }
  )

  ipcMain.handle(
    'db:conversation-messages:update',
    (
      _event,
      id: string,
      data: {
        content?: string
        thinking?: string
        tool_result?: string
        tool_is_error?: boolean
      }
    ) => {
      conversations.updateConversationMessage(db, id, data)
    }
  )
}
