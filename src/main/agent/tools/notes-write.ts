import type Database from 'better-sqlite3'
import { createAgentLog } from '../../database/repositories/agent-logs'
import { applyEdit, applyMetadataEdit } from '../session'
// Documents/folders are file-backed: route agent writes through the vault
// service so they hit the .md file on disk (the source of truth), not just the
// derived SQLite index (which gets rebuilt from disk and would discard them).
import {
  createDocument,
  getDocument,
  updateDocument,
  createFolder,
  reindexFile
} from '../../vault/documents-service'
import { getFolder } from '../../database/repositories/folders'
import { getWorkspace } from '../../database/repositories/workspaces'
import { writeWorkspaceDoc, workspaceDocPath } from '../../vault/workspace-docs'
import { createMarkdownDiff } from '../../markdown/diff'
import { markdownToTiptap, tiptapToMarkdown, type TTDoc } from '../../markdown/tiptap-markdown'
import { RESERVED_KEYS } from '../../vault/metadata'
import type { AgentLog } from '../../database/types'
import type { ToolResult } from './notes-read'

/** One note's worth of metadata changes in a batched proposal. */
export interface MetadataEdit {
  document_id: string
  /** Property changes to merge; a `null` value clears (deletes) the key. */
  changedKeys: Record<string, unknown>
}

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
): ToolResult & { docId?: string | null } {
  if (!workspaceId) {
    return { content: '', error: 'No workspace context available' }
  }
  const workspace = getWorkspace(db, workspaceId)
  if (!workspace) {
    return { content: '', error: `Workspace not found: ${workspaceId}` }
  }
  writeWorkspaceDoc(db, workspaceId, 'description', params.description)
  // These docs are indexed notes; the watcher's self-write guard skips the app's
  // own bytes, so reindex here to keep the index (row / notes_fts / note_links)
  // fresh and surface the docId for a content-changed live-reload broadcast.
  const reindexed = reindexFile(db, workspaceDocPath(db, workspaceId, 'description'))
  const docId = 'docId' in reindexed ? reindexed.docId : null
  return { content: `Workspace description updated successfully.`, docId }
}

export function notesUpdateWorkspaceMemory(
  db: Database.Database,
  params: { memory: string },
  workspaceId: string
): ToolResult & { docId?: string | null } {
  if (!workspaceId) {
    return { content: '', error: 'No workspace context available' }
  }
  const workspace = getWorkspace(db, workspaceId)
  if (!workspace) {
    return { content: '', error: `Workspace not found: ${workspaceId}` }
  }
  writeWorkspaceDoc(db, workspaceId, 'memory', params.memory)
  // These docs are indexed notes; the watcher's self-write guard skips the app's
  // own bytes, so reindex here to keep the index (row / notes_fts / note_links)
  // fresh and surface the docId for a content-changed live-reload broadcast.
  const reindexed = reindexFile(db, workspaceDocPath(db, workspaceId, 'memory'))
  const docId = 'docId' in reindexed ? reindexed.docId : null
  return { content: 'Workspace memory updated successfully.', docId }
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

export async function notesProposeEdit(
  db: Database.Database,
  params: {
    document_id: string
    old_text: string
    new_text: string
  },
  autoApprove?: boolean
): Promise<ToolResult & { log?: AgentLog }> {
  if (!params.document_id) {
    return { content: '', error: 'document_id is required' }
  }
  if (params.old_text === undefined || params.old_text === null) {
    return { content: '', error: 'old_text is required' }
  }
  if (params.new_text === undefined || params.new_text === null) {
    return { content: '', error: 'new_text is required' }
  }

  const target = getDocument(db, params.document_id)
  if (!target) {
    return { content: '', error: `Document not found: ${params.document_id}` }
  }
  if (target.kind && target.kind !== 'note') {
    return {
      content: '',
      error: `"${target.title}" is a ${target.kind} artifact, not a markdown note — markdown patches do not apply. Regenerate the file on disk instead.`
    }
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
    await applyEdit(db, log.id)
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

/**
 * Propose a (possibly batched) metadata change across one or more notes (Phase 5,
 * C3). This is the metadata-aware sibling of `notesProposeEdit`: instead of a
 * markdown find-and-replace it merges frontmatter properties via the
 * `updateFrontmatter` chokepoint (which rejects RESERVED_KEYS). The proposal is
 * stored as one `agent_logs` row with `action_type='propose_metadata'` whose
 * `metadata_payload` holds the JSON array of `{ document_id, changedKeys }`,
 * applied by iterating on approve.
 *
 * Reserved keys (`id`/`title`/`created`/`updated`) are stripped up-front and
 * surfaced back to the model so it knows they were ignored. Returns an error when
 * no applicable change remains.
 */
export function notesProposeMetadata(
  db: Database.Database,
  params: { edits: MetadataEdit[] },
  autoApprove?: boolean,
  workspaceId?: string
): ToolResult & { log?: AgentLog } {
  if (!params.edits || !Array.isArray(params.edits) || params.edits.length === 0) {
    return { content: '', error: 'edits must be a non-empty array' }
  }

  const rejectedKeys = new Set<string>()
  const cleaned: MetadataEdit[] = []

  for (const edit of params.edits) {
    if (!edit || !edit.document_id) {
      return { content: '', error: 'each edit requires a document_id' }
    }
    if (!edit.changedKeys || typeof edit.changedKeys !== 'object') {
      return { content: '', error: `changedKeys must be an object (document ${edit.document_id})` }
    }

    const doc = getDocument(db, edit.document_id)
    if (!doc) {
      return { content: '', error: `Document not found: ${edit.document_id}` }
    }
    if (workspaceId && doc.workspace_id !== workspaceId) {
      return { content: '', error: `Document not in current workspace: ${edit.document_id}` }
    }
    if (doc.kind && doc.kind !== 'note') {
      return {
        content: '',
        error: `"${doc.title}" is a ${doc.kind} artifact, not a markdown note — it has no frontmatter to set.`
      }
    }

    // Strip reserved keys here too so the model learns immediately; the
    // updateFrontmatter chokepoint enforces it again at apply time (M2).
    const changedKeys: Record<string, unknown> = {}
    for (const key of Object.keys(edit.changedKeys)) {
      if (RESERVED_KEYS.has(key)) {
        rejectedKeys.add(key)
        continue
      }
      changedKeys[key] = edit.changedKeys[key]
    }
    if (Object.keys(changedKeys).length > 0) {
      cleaned.push({ document_id: edit.document_id, changedKeys })
    }
  }

  if (cleaned.length === 0) {
    const detail =
      rejectedKeys.size > 0
        ? ` Only reserved keys were provided (${[...rejectedKeys].join(', ')}), which cannot be set.`
        : ''
    return { content: '', error: `No applicable metadata changes to propose.${detail}` }
  }

  const log = createAgentLog(db, {
    document_id: cleaned[0].document_id,
    agent_name: 'notes-assistant',
    action_type: 'propose_metadata',
    metadata_payload: JSON.stringify(cleaned)
  })

  const rejectedNote =
    rejectedKeys.size > 0 ? ` Reserved keys were ignored: ${[...rejectedKeys].join(', ')}.` : ''

  if (autoApprove) {
    const applied = applyMetadataEdit(db, log.id)
    const extra =
      applied.rejectedKeys.length > 0 ? ` Rejected keys: ${applied.rejectedKeys.join(', ')}.` : ''
    return {
      content: `Metadata applied to ${cleaned.length} note(s). Log ID: ${log.id}.${rejectedNote}${extra}`,
      log
    }
  }

  return {
    content: `Metadata change proposed for ${cleaned.length} note(s). Log ID: ${log.id}. The user will be asked to approve or reject.${rejectedNote}`,
    log
  }
}
