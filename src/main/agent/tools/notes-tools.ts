import { basename } from 'path'
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { Type } from 'typebox'
import {
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent'
import { getWorkspaceDir } from '../paths'
import { addWorkspaceFile, listWorkspaceFiles } from '../../database/repositories/workspace-files'
import { isPathInsideAnyVault } from '../../vault/documents-service'
import { createWebSearchTool } from './web-search'
import { createWebFetchTool } from './web-fetch'
import { createSubagentTool } from '../subagent/tool'
import { createScheduledTaskTool } from './scheduled-task-tool'
import { createUpdateShareTool } from './share-tool'
import { createNotesGitTools } from './notes-git-tools'
import { createMcpProxyTool } from '../../mcp'
import {
  createCalendarTools,
  createGmailTools,
  createDriveTools,
  hasGoogleService
} from '../../google'
import { hasMicrosoftService, createOutlookTools } from '../../microsoft'

export function createNotesTools(
  db: Database.Database,
  window: BrowserWindow,
  workspaceId?: string,
  // Chat conversation that owns this session — lets the subagent tool tag its
  // forwarded events so the renderer routes them across concurrent conversations
  conversationId?: string
): ToolDefinition[] {
  const workspaceAddFileTool: ToolDefinition = {
    name: 'workspace_add_file',
    label: 'Add File to Context',
    description:
      'Add a file to the workspace file context so it persists across conversations. Use this whenever you create a file the user will need ongoing access to, or when the user asks to add a file to their workspace context. Accepts an absolute file path.',
    parameters: Type.Object({
      file_path: Type.String({
        description: 'Absolute path to the file to add to workspace context'
      })
    }),
    async execute(_toolCallId, params) {
      const p = params as { file_path: string }
      if (!workspaceId) {
        return {
          content: [{ type: 'text' as const, text: 'Error: No workspace context' }],
          details: undefined
        }
      }
      if (!p.file_path || p.file_path.trim().length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Error: file_path is required' }],
          details: undefined
        }
      }

      const filePath = p.file_path.trim()
      const fileName = basename(filePath)

      // Reject a path inside any workspace notes folder: such a file is already a
      // first-class artifact in the document tree (or a note), so listing it in
      // the flat Files section too would double-list it. Files belong here only
      // when they live OUTSIDE the vault.
      if (isPathInsideAnyVault(db, filePath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `"${fileName}" is inside the workspace notes folder, so it is already a first-class document/artifact in the tree — no need to add it to the Files section. Open it from the document explorer instead.`
            }
          ],
          details: undefined
        }
      }

      // Check if file is already in workspace context
      const existing = listWorkspaceFiles(db, workspaceId)
      if (existing.some((f) => f.file_path === filePath)) {
        return {
          content: [
            { type: 'text' as const, text: `File "${fileName}" is already in workspace context.` }
          ],
          details: undefined
        }
      }

      try {
        addWorkspaceFile(db, {
          workspace_id: workspaceId,
          file_path: filePath,
          file_name: fileName
        })
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error adding file: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          details: undefined
        }
      }

      if (!window.isDestroyed()) {
        window.webContents.send('workspace-files:changed')
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `File "${fileName}" added to workspace context successfully.`
          }
        ],
        details: undefined
      }
    }
  }

  const webSearchTool = createWebSearchTool()
  const webFetchTool = createWebFetchTool()
  const subagentTool = createSubagentTool(db, window, workspaceId, conversationId)

  const workspaceDir = getWorkspaceDir(db, workspaceId)
  const tools: ToolDefinition[] = [
    createGrepToolDefinition(workspaceDir) as ToolDefinition,
    createFindToolDefinition(workspaceDir) as ToolDefinition,
    createLsToolDefinition(workspaceDir) as ToolDefinition,
    workspaceAddFileTool,
    createUpdateShareTool(db),
    ...createNotesGitTools(db, workspaceId),
    webSearchTool,
    webFetchTool,
    subagentTool
  ]

  if (workspaceId) {
    tools.push(createScheduledTaskTool(db, window, workspaceId))
  }

  tools.push(createMcpProxyTool())

  if (hasGoogleService('calendar')) {
    tools.push(...createCalendarTools())
  }
  if (hasGoogleService('gmail')) {
    tools.push(...createGmailTools())
  }
  if (hasGoogleService('drive')) {
    tools.push(...createDriveTools())
  }

  if (hasMicrosoftService('outlook')) {
    tools.push(...createOutlookTools())
  }

  return tools
}
