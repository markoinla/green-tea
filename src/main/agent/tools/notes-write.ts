import type Database from 'better-sqlite3'
import { createAgentLog } from '../../database/repositories/agent-logs'
import { applyEdit } from '../session'
// Documents/folders are file-backed: route agent writes through the vault
// service so they hit the .md file on disk (the source of truth), not just the
// derived SQLite index (which gets rebuilt from disk and would discard them).
import {
  createDocument,
  getDocument,
  updateDocument,
  createFolder
} from '../../vault/documents-service'
import { getFolder } from '../../database/repositories/folders'
import { updateWorkspace, getWorkspace } from '../../database/repositories/workspaces'
import { createMarkdownDiff } from '../../markdown/diff'
import { markdownToTiptap, tiptapToMarkdown, type TTDoc } from '../../markdown/tiptap-markdown'
import type { AgentLog } from '../../database/types'
import type { ToolResult } from './notes-read'

// NOTE: the block<->TipTap conversion helpers that previously lived here are
// gone — agent edits now flow through the markdown converter + vault service.

export function notesCreateDocument(
  db: Database.Database,
  params: { title: string; markdown?: string },
  workspaceId?: string
): ToolResult {
  if (!params.title || params.title.trim().length === 0) {
    return { content: '', error: 'title is required' }
  }

  let content: string | undefined
  if (params.markdown && params.markdown.trim().length > 0) {
    content = JSON.stringify(markdownToTiptap(params.markdown))
  }

  const doc = createDocument(db, { title: params.title.trim(), content, workspace_id: workspaceId })

  return {
    content: `Document created successfully. ID: ${doc.id}, Title: "${doc.title}"`
  }
}

export function notesUpdateWorkspaceDescription(
  db: Database.Database,
  params: { description: string },
  workspaceId: string
): ToolResult {
  if (!workspaceId) {
    return { content: '', error: 'No workspace context available' }
  }
  const workspace = getWorkspace(db, workspaceId)
  if (!workspace) {
    return { content: '', error: `Workspace not found: ${workspaceId}` }
  }
  updateWorkspace(db, workspaceId, { description: params.description })
  return { content: `Workspace description updated successfully.` }
}

export function notesUpdateWorkspaceMemory(
  db: Database.Database,
  params: { memory: string },
  workspaceId: string
): ToolResult {
  if (!workspaceId) {
    return { content: '', error: 'No workspace context available' }
  }
  const workspace = getWorkspace(db, workspaceId)
  if (!workspace) {
    return { content: '', error: `Workspace not found: ${workspaceId}` }
  }
  updateWorkspace(db, workspaceId, { memory: params.memory })
  return { content: 'Workspace memory updated successfully.' }
}

export function notesCreateFolder(
  db: Database.Database,
  params: { name: string },
  workspaceId?: string
): ToolResult {
  if (!params.name || params.name.trim().length === 0) {
    return { content: '', error: 'name is required' }
  }
  if (!workspaceId) {
    return { content: '', error: 'No workspace context available' }
  }

  const folder = createFolder(db, { name: params.name.trim(), workspace_id: workspaceId })

  return {
    content: `Folder created successfully. ID: ${folder.id}, Name: "${folder.name}"`
  }
}

export function notesMoveToFolder(
  db: Database.Database,
  params: { document_id: string; folder_id: string | null }
): ToolResult {
  if (!params.document_id) {
    return { content: '', error: 'document_id is required' }
  }

  const doc = getDocument(db, params.document_id)
  if (!doc) {
    return { content: '', error: `Document not found: ${params.document_id}` }
  }

  if (params.folder_id !== null) {
    const folder = getFolder(db, params.folder_id)
    if (!folder) {
      return { content: '', error: `Folder not found: ${params.folder_id}` }
    }
  }

  updateDocument(db, params.document_id, { folder_id: params.folder_id })

  const destination = params.folder_id === null ? 'root (no folder)' : `folder ${params.folder_id}`
  return {
    content: `Note "${doc.title}" moved to ${destination} successfully.`
  }
}

export function getCurrentMarkdown(
  db: Database.Database,
  documentId: string
): { markdown: string; title: string } | null {
  // getDocument routes through the vault service, so content is read fresh from
  // the .md file (the source of truth) and converted with the canonical converter.
  const doc = getDocument(db, documentId)
  if (!doc) return null

  const body = doc.content ? tiptapToMarkdown(JSON.parse(doc.content) as TTDoc).trim() : ''
  const markdown =
    body.length > 0 ? `# ${doc.title}\n\n${body}` : `# ${doc.title}\n\n(empty document)`
  return { markdown, title: doc.title }
}

export function notesProposeEdit(
  db: Database.Database,
  params: {
    document_id: string
    old_text: string
    new_text: string
  },
  autoApprove?: boolean
): ToolResult & { log?: AgentLog } {
  if (!params.document_id) {
    return { content: '', error: 'document_id is required' }
  }
  if (params.old_text === undefined || params.old_text === null) {
    return { content: '', error: 'old_text is required' }
  }
  if (params.new_text === undefined || params.new_text === null) {
    return { content: '', error: 'new_text is required' }
  }

  const current = getCurrentMarkdown(db, params.document_id)
  if (!current) {
    return { content: '', error: `Document not found: ${params.document_id}` }
  }

  // Find and replace old_text in the current markdown
  const occurrences = current.markdown.split(params.old_text).length - 1
  if (occurrences === 0) {
    return {
      content: '',
      error: 'old_text not found in document. Read the note first to get the exact text.'
    }
  }
  if (occurrences > 1) {
    return {
      content: '',
      error: `old_text found ${occurrences} times — provide more surrounding context to make it unique.`
    }
  }

  const newMarkdown = current.markdown.replace(params.old_text, params.new_text)
  const diff = createMarkdownDiff(current.markdown, newMarkdown)

  const log = createAgentLog(db, {
    document_id: params.document_id,
    block_id: undefined,
    agent_name: 'notes-assistant',
    action_type: 'propose_patch',
    input_markdown: newMarkdown,
    output_patch: diff,
    old_text: params.old_text,
    new_text: params.new_text
  })

  if (autoApprove) {
    applyEdit(db, log.id)
    return {
      content: `Edit applied successfully. Log ID: ${log.id}.`,
      log
    }
  }

  return {
    content: `Edit proposed successfully. Log ID: ${log.id}. The user will be asked to approve or reject the changes.`,
    log
  }
}
