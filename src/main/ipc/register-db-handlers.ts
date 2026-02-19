import { ipcMain } from 'electron'
import { mkdirSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import * as documents from '../database/repositories/documents'
import * as blocks from '../database/repositories/blocks'
import * as agentLogs from '../database/repositories/agent-logs'
import * as folders from '../database/repositories/folders'
import * as workspaces from '../database/repositories/workspaces'
import * as settings from '../database/repositories/settings'
import * as conversations from '../database/repositories/conversations'
import * as documentVersions from '../database/repositories/document-versions'
import type { BlockNode } from '../database/types'
import type { SerializableBlock } from '../markdown/types'
import { serializeBlocks } from '../markdown/serialize'
import { deserializeMarkdown } from '../markdown/deserialize'
import { restartThemeWatcher } from '../theme-watcher'
import { resetSession } from '../agent/session'
import { getAgentBaseDir, sanitizeWorkspaceName } from '../agent/paths'
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
    const baseDir = getAgentBaseDir(db)
    const dirName = sanitizeWorkspaceName(workspace.name)
    mkdirSync(join(baseDir, 'agent-workspace', dirName), { recursive: true })
    mainWindow?.webContents.send('workspaces:changed')
    return workspace
  })

  ipcMain.handle(
    'db:workspaces:update',
    (_event, id: string, data: { name?: string; description?: string }) => {
      if (data.name) {
        const oldWorkspace = workspaces.getWorkspace(db, id)
        if (oldWorkspace && data.name !== oldWorkspace.name) {
          const baseDir = getAgentBaseDir(db)
          const oldDir = join(baseDir, 'agent-workspace', sanitizeWorkspaceName(oldWorkspace.name))
          const newDir = join(baseDir, 'agent-workspace', sanitizeWorkspaceName(data.name))
          if (existsSync(oldDir)) {
            renameSync(oldDir, newDir)
          }
        }
      }
      const workspace = workspaces.updateWorkspace(db, id, data)
      mainWindow?.webContents.send('workspaces:changed')
      return workspace
    }
  )

  ipcMain.handle('db:workspaces:delete', (_event, id: string) => {
    workspaces.deleteWorkspace(db, id)
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
      if (isContentOnly) {
        mainWindow?.webContents.send('documents:content-changed', { id })
      } else {
        mainWindow?.webContents.send('documents:changed')
      }
      return doc
    }
  )

  ipcMain.handle('db:documents:delete', (_event, id: string) => {
    documents.deleteDocument(db, id)
    mainWindow?.webContents.send('documents:changed')
  })

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
    documentVersions.restoreVersion(db, id)
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
    const folder = folders.createFolder(db, data)
    mainWindow?.webContents.send('folders:changed')
    return folder
  })

  ipcMain.handle(
    'db:folders:update',
    (_event, id: string, data: { name?: string; collapsed?: number }) => {
      const folder = folders.updateFolder(db, id, data)
      mainWindow?.webContents.send('folders:changed')
      return folder
    }
  )

  ipcMain.handle('db:folders:delete', (_event, id: string) => {
    folders.deleteFolder(db, id)
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
    }
  })

  ipcMain.handle('db:settings:get-all', () => {
    return settings.getAllSettings(db)
  })

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
