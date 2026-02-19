import { basename } from 'path'
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import {
  notesListDocuments,
  notesListFolders,
  notesGetMarkdown,
  notesSearch,
  notesGetOutline
} from './notes-read'
import {
  notesCreateDocument,
  notesCreateFolder,
  notesMoveToFolder,
  notesProposeEdit,
  notesUpdateWorkspaceDescription,
  notesUpdateWorkspaceMemory
} from './notes-write'
import { addWorkspaceFile, listWorkspaceFiles } from '../../database/repositories/workspace-files'
import { getSetting } from '../../database/repositories/settings'
import { createWebSearchTool } from './web-search'
import { createWebFetchTool } from './web-fetch'
import { createSubagentTool } from '../subagent/tool'
import { createScheduledTaskTool } from './scheduled-task-tool'
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
  autoApprove?: boolean
): ToolDefinition[] {
  const notesListTool: ToolDefinition = {
    name: 'notes_list',
    label: 'List Notes',
    description: 'List all notes in the workspace with their IDs and titles.',
    parameters: Type.Object({}),
    async execute() {
      const result = notesListDocuments(db, workspaceId)
      return {
        content: [{ type: 'text' as const, text: result.content }],
        details: undefined
      }
    }
  }

  const notesListFoldersTool: ToolDefinition = {
    name: 'notes_list_folders',
    label: 'List Folders',
    description: 'List all folders in the workspace with their IDs and names.',
    parameters: Type.Object({}),
    async execute() {
      const result = notesListFolders(db, workspaceId)
      return {
        content: [{ type: 'text' as const, text: result.content }],
        details: undefined
      }
    }
  }

  const notesGetMarkdownTool: ToolDefinition = {
    name: 'notes_get_markdown',
    label: 'Get Markdown',
    description:
      'Get the Markdown content of a note or a specific block. Provide either document_id or block_id.',
    parameters: Type.Object({
      document_id: Type.Optional(Type.String({ description: 'The note ID to read' })),
      block_id: Type.Optional(Type.String({ description: 'A specific block ID to read' }))
    }),
    async execute(_toolCallId, params) {
      const p = params as { document_id?: string; block_id?: string }
      const result = notesGetMarkdown(db, p, workspaceId)
      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
          details: undefined
        }
      }
      return {
        content: [{ type: 'text' as const, text: result.content }],
        details: undefined
      }
    }
  }

  const notesSearchTool: ToolDefinition = {
    name: 'notes_search',
    label: 'Search Notes',
    description:
      'Search block content across all notes. Returns matching blocks with their note context.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query (matched with SQL LIKE)' })
    }),
    async execute(_toolCallId, params) {
      const p = params as { query: string }
      const result = notesSearch(db, p, workspaceId)
      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
          details: undefined
        }
      }
      return {
        content: [{ type: 'text' as const, text: result.content }],
        details: undefined
      }
    }
  }

  const notesGetOutlineTool: ToolDefinition = {
    name: 'notes_get_outline',
    label: 'Get Outline',
    description:
      'Get an outline of a note showing headings and top-level blocks. Useful for understanding note structure without reading full content.',
    parameters: Type.Object({
      document_id: Type.String({ description: 'The note ID to outline' })
    }),
    async execute(_toolCallId, params) {
      const p = params as { document_id: string }
      const result = notesGetOutline(db, p, workspaceId)
      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
          details: undefined
        }
      }
      return {
        content: [{ type: 'text' as const, text: result.content }],
        details: undefined
      }
    }
  }

  const notesCreateTool: ToolDefinition = {
    name: 'notes_create',
    label: 'Create Note',
    description:
      'Create a new note in the workspace. Optionally provide initial Markdown content to populate it.',
    parameters: Type.Object({
      title: Type.String({ description: 'The title for the new note' }),
      markdown: Type.Optional(
        Type.String({ description: 'Optional initial Markdown content for the note' })
      )
    }),
    async execute(_toolCallId, params) {
      const p = params as { title: string; markdown?: string }
      const result = notesCreateDocument(db, p, workspaceId)
      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
          details: undefined
        }
      }
      if (!window.isDestroyed()) {
        window.webContents.send('documents:changed')
      }
      return {
        content: [{ type: 'text' as const, text: result.content }],
        details: undefined
      }
    }
  }

  const notesProposeEditTool: ToolDefinition = {
    name: 'notes_propose_edit',
    label: 'Propose Edit',
    description:
      'Propose a search-and-replace edit to a note. Provide the exact text to find (old_text) and the replacement (new_text). The old_text must match exactly one location in the note. Read the note first with notes_get_markdown to get the exact text.',
    parameters: Type.Object({
      document_id: Type.String({ description: 'The note ID to edit' }),
      old_text: Type.String({
        description: 'The exact text to find in the note. Must match exactly once.'
      }),
      new_text: Type.String({
        description: 'The replacement text.'
      })
    }),
    async execute(_toolCallId, params) {
      const p = params as { document_id: string; old_text: string; new_text: string }
      const shouldAutoApprove = autoApprove ?? getSetting(db, 'autoApproveEdits') !== 'false'
      const result = notesProposeEdit(db, p, shouldAutoApprove)
      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
          details: undefined
        }
      }
      if (shouldAutoApprove) {
        if (!window.isDestroyed()) {
          window.webContents.send('documents:content-changed', { id: p.document_id })
        }
        return {
          content: [{ type: 'text' as const, text: result.content }],
          details: undefined
        }
      }
      return {
        content: [{ type: 'text' as const, text: result.content }],
        details: result.log
      }
    }
  }

  const notesUpdateWorkspaceDescTool: ToolDefinition = {
    name: 'notes_update_workspace_description',
    label: 'Update Workspace Description',
    description:
      'Update the workspace description (like a CLAUDE.md). Use this to record project context, conventions, architecture notes, or other persistent information about the current workspace.',
    parameters: Type.Object({
      description: Type.String({ description: 'The new workspace description content (markdown)' })
    }),
    async execute(_toolCallId, params) {
      const p = params as { description: string }
      if (!workspaceId) {
        return {
          content: [{ type: 'text' as const, text: 'Error: No workspace context' }],
          details: undefined
        }
      }
      const result = notesUpdateWorkspaceDescription(db, p, workspaceId)
      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
          details: undefined
        }
      }
      if (!window.isDestroyed()) {
        window.webContents.send('workspaces:changed')
      }
      return {
        content: [{ type: 'text' as const, text: result.content }],
        details: undefined
      }
    }
  }

  const notesUpdateWorkspaceMemoryTool: ToolDefinition = {
    name: 'notes_update_workspace_memory',
    label: 'Update Workspace Memory',
    description:
      'Update the workspace memory — a persistent markdown note that survives across conversations. Write the complete memory content (not a diff). Read the current memory from the prompt context first if you need to preserve existing entries.',
    parameters: Type.Object({
      memory: Type.String({ description: 'The full workspace memory content (markdown)' })
    }),
    async execute(_toolCallId, params) {
      const p = params as { memory: string }
      if (!workspaceId) {
        return {
          content: [{ type: 'text' as const, text: 'Error: No workspace context' }],
          details: undefined
        }
      }
      const result = notesUpdateWorkspaceMemory(db, p, workspaceId)
      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
          details: undefined
        }
      }
      if (!window.isDestroyed()) {
        window.webContents.send('workspaces:changed')
      }
      return {
        content: [{ type: 'text' as const, text: result.content }],
        details: undefined
      }
    }
  }

  const notesCreateFolderTool: ToolDefinition = {
    name: 'notes_create_folder',
    label: 'Create Folder',
    description: 'Create a new folder in the workspace. Use this to organize notes into groups.',
    parameters: Type.Object({
      name: Type.String({ description: 'The name for the new folder' })
    }),
    async execute(_toolCallId, params) {
      const p = params as { name: string }
      const result = notesCreateFolder(db, p, workspaceId)
      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
          details: undefined
        }
      }
      if (!window.isDestroyed()) {
        window.webContents.send('folders:changed')
      }
      return {
        content: [{ type: 'text' as const, text: result.content }],
        details: undefined
      }
    }
  }

  const notesMoveToFolderTool: ToolDefinition = {
    name: 'notes_move_to_folder',
    label: 'Move Note to Folder',
    description:
      'Move a note into a folder, or remove it from its current folder. Use notes_list to find note IDs and notes_create_folder to create folders first.',
    parameters: Type.Object({
      document_id: Type.String({ description: 'The note ID to move' }),
      folder_id: Type.Union([Type.String(), Type.Null()], {
        description: 'The folder ID to move the note into, or null to remove from folder'
      })
    }),
    async execute(_toolCallId, params) {
      const p = params as { document_id: string; folder_id: string | null }
      const result = notesMoveToFolder(db, p)
      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
          details: undefined
        }
      }
      if (!window.isDestroyed()) {
        window.webContents.send('documents:changed')
        window.webContents.send('folders:changed')
      }
      return {
        content: [{ type: 'text' as const, text: result.content }],
        details: undefined
      }
    }
  }

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
  const subagentTool = createSubagentTool(db, window, workspaceId)

  const tools: ToolDefinition[] = [
    notesListTool,
    notesListFoldersTool,
    notesGetMarkdownTool,
    notesGetOutlineTool,
    notesSearchTool,
    notesCreateTool,
    notesCreateFolderTool,
    notesMoveToFolderTool,
    notesProposeEditTool,
    notesUpdateWorkspaceDescTool,
    notesUpdateWorkspaceMemoryTool,
    workspaceAddFileTool,
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
