import type Database from 'better-sqlite3'
import { createAgentLog } from '../../database/repositories/agent-logs'
import { applyEdit } from '../session'
import { createDocument, getDocument, updateDocument } from '../../database/repositories/documents'
import { getBlockTree } from '../../database/repositories/blocks'
import { createFolder, getFolder } from '../../database/repositories/folders'
import { updateWorkspace, getWorkspace } from '../../database/repositories/workspaces'
import { deserializeMarkdown } from '../../markdown/deserialize'
import { serializeBlocks } from '../../markdown/serialize'
import { createMarkdownDiff } from '../../markdown/diff'
import { tiptapJsonToBlocks } from '../../markdown/tiptap-to-blocks'
import type { SerializableBlock } from '../../markdown/types'
import type { BlockNode } from '../../database/types'
import type { AgentLog } from '../../database/types'
import type { ToolResult } from './notes-read'

interface JSONContent {
  type: string
  attrs?: Record<string, unknown>
  content?: JSONContent[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

function parseInlineMarkdown(text: string): JSONContent[] {
  // Matches: **bold**, *italic*, `code`, ~~strike~~, [text](url)
  // Order matters: ** before * so bold is matched before italic
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|\[([^\]]+)\]\(([^)]+)\)/g
  const nodes: JSONContent[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    }

    if (match[1] !== undefined) {
      nodes.push({ type: 'text', text: match[1], marks: [{ type: 'bold' }] })
    } else if (match[2] !== undefined) {
      nodes.push({ type: 'text', text: match[2], marks: [{ type: 'italic' }] })
    } else if (match[3] !== undefined) {
      nodes.push({ type: 'text', text: match[3], marks: [{ type: 'code' }] })
    } else if (match[4] !== undefined) {
      nodes.push({ type: 'text', text: match[4], marks: [{ type: 'strike' }] })
    } else if (match[5] !== undefined) {
      nodes.push({
        type: 'text',
        text: match[5],
        marks: [{ type: 'link', attrs: { href: match[6] } }]
      })
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', text }]
}

function blockToInlineContent(block: SerializableBlock): JSONContent {
  const inlineContent = block.content ? parseInlineMarkdown(block.content) : undefined

  switch (block.type) {
    case 'heading1':
      return inlineContent
        ? { type: 'heading', attrs: { level: 1 }, content: inlineContent }
        : { type: 'heading', attrs: { level: 1 } }
    case 'heading2':
      return inlineContent
        ? { type: 'heading', attrs: { level: 2 }, content: inlineContent }
        : { type: 'heading', attrs: { level: 2 } }
    case 'heading3':
      return inlineContent
        ? { type: 'heading', attrs: { level: 3 }, content: inlineContent }
        : { type: 'heading', attrs: { level: 3 } }
    case 'heading4':
      return inlineContent
        ? { type: 'heading', attrs: { level: 4 }, content: inlineContent }
        : { type: 'heading', attrs: { level: 4 } }
    case 'heading5':
      return inlineContent
        ? { type: 'heading', attrs: { level: 5 }, content: inlineContent }
        : { type: 'heading', attrs: { level: 5 } }
    case 'code_block':
      // Code blocks should keep content as plain text (no inline formatting)
      return block.content
        ? { type: 'codeBlock', content: [{ type: 'text', text: block.content }] }
        : { type: 'codeBlock' }
    case 'blockquote':
      return inlineContent
        ? { type: 'blockquote', content: [{ type: 'paragraph', content: inlineContent }] }
        : { type: 'blockquote', content: [{ type: 'paragraph' }] }
    case 'table': {
      if (!block.rows || block.rows.length === 0) {
        return { type: 'paragraph' }
      }
      const tableRows: JSONContent[] = block.rows.map((row, rowIndex) => ({
        type: 'tableRow',
        content: row.map((cell) => ({
          type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
          content: [
            cell ? { type: 'paragraph', content: parseInlineMarkdown(cell) } : { type: 'paragraph' }
          ]
        }))
      }))
      return { type: 'table', content: tableRows }
    }
    default:
      return inlineContent ? { type: 'paragraph', content: inlineContent } : { type: 'paragraph' }
  }
}

function blockToOutlinerItem(block: SerializableBlock): JSONContent {
  const attrs: Record<string, unknown> = { blockType: block.type }
  if (block.type === 'task_item') {
    attrs.checked = block.checked ?? false
  }

  const itemContent: JSONContent[] = [blockToInlineContent(block)]

  if (block.children.length > 0) {
    itemContent.push({
      type: 'outlinerList',
      content: block.children.map(blockToOutlinerItem)
    })
  }

  return {
    type: 'outlinerItem',
    attrs,
    content: itemContent
  }
}

export function blocksToDocJSON(blocks: SerializableBlock[]): JSONContent {
  const docContent: JSONContent[] = []
  let listBuffer: SerializableBlock[] = []
  let taskBuffer: SerializableBlock[] = []

  function flushListBuffer(): void {
    if (listBuffer.length > 0) {
      docContent.push({
        type: 'outlinerList',
        content: listBuffer.map(blockToOutlinerItem)
      })
      listBuffer = []
    }
  }

  function flushTaskBuffer(): void {
    if (taskBuffer.length > 0) {
      docContent.push({
        type: 'taskList',
        content: taskBuffer.map(blockToTaskItem)
      })
      taskBuffer = []
    }
  }

  for (const block of blocks) {
    if (block.type === 'task_item') {
      flushListBuffer()
      taskBuffer.push(block)
    } else if (block.isList) {
      flushTaskBuffer()
      listBuffer.push(block)
    } else {
      flushListBuffer()
      flushTaskBuffer()
      docContent.push(blockToInlineContent(block))
    }
  }

  flushListBuffer()
  flushTaskBuffer()

  // If the document ended up empty, add an empty paragraph
  if (docContent.length === 0) {
    docContent.push({ type: 'paragraph' })
  }

  return {
    type: 'doc',
    content: docContent
  }
}

/**
 * Convert a task_item block into a TipTap taskItem node.
 */
function blockToTaskItem(block: SerializableBlock): JSONContent {
  const inlineContent = block.content ? parseInlineMarkdown(block.content) : undefined
  const taskItem: JSONContent = {
    type: 'taskItem',
    attrs: { checked: block.checked ?? false },
    content: [
      inlineContent ? { type: 'paragraph', content: inlineContent } : { type: 'paragraph' }
    ]
  }

  // Nest child task items as a sub-taskList
  const childTasks = block.children.filter((c) => c.type === 'task_item')
  if (childTasks.length > 0) {
    taskItem.content!.push({
      type: 'taskList',
      content: childTasks.map(blockToTaskItem)
    })
  }

  return taskItem
}

/**
 * Convert blocks to flat TipTap JSON — no outlinerList wrapping.
 * Used by approveEdit so agent edits don't introduce bullet points.
 */
export function blocksToFlatDocJSON(blocks: SerializableBlock[]): JSONContent {
  const docContent: JSONContent[] = []
  let taskBuffer: SerializableBlock[] = []

  function flushTaskBuffer(): void {
    if (taskBuffer.length > 0) {
      docContent.push({
        type: 'taskList',
        content: taskBuffer.map(blockToTaskItem)
      })
      taskBuffer = []
    }
  }

  function flatten(blocks: SerializableBlock[]): void {
    for (const block of blocks) {
      if (block.type === 'task_item') {
        taskBuffer.push(block)
      } else {
        flushTaskBuffer()
        docContent.push(blockToInlineContent(block))
        if (block.children.length > 0) {
          flatten(block.children)
        }
      }
    }
  }

  flatten(blocks)
  flushTaskBuffer()

  if (docContent.length === 0) {
    docContent.push({ type: 'paragraph' })
  }

  return {
    type: 'doc',
    content: docContent
  }
}

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
    const blocks = deserializeMarkdown(params.markdown)
    if (blocks.length > 0) {
      content = JSON.stringify(blocksToDocJSON(blocks))
    }
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

function blockNodeToSerializable(node: BlockNode): SerializableBlock {
  const block: SerializableBlock = {
    id: node.id,
    type: node.type as SerializableBlock['type'],
    content: node.content,
    isList: true,
    children: node.children.map(blockNodeToSerializable)
  }
  if (node.type === 'task_item') {
    block.checked = node.content.startsWith('[x] ') || node.collapsed === 1
  }
  return block
}

export function getCurrentMarkdown(
  db: Database.Database,
  documentId: string
): { markdown: string; title: string } | null {
  const doc = getDocument(db, documentId)
  if (!doc) return null

  let serializableBlocks: SerializableBlock[]

  if (doc.content) {
    serializableBlocks = tiptapJsonToBlocks(doc.content)
  } else {
    const tree = getBlockTree(db, documentId)
    serializableBlocks = tree.map(blockNodeToSerializable)
  }

  if (serializableBlocks.length === 0) {
    return { markdown: `# ${doc.title}\n\n(empty document)`, title: doc.title }
  }

  const blocksMarkdown = serializeBlocks(serializableBlocks)
  return { markdown: `# ${doc.title}\n\n${blocksMarkdown}`, title: doc.title }
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
