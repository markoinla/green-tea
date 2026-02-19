import type Database from 'better-sqlite3'
import { getBlockTree } from '../../database/repositories/blocks'
import { listDocuments, getDocument } from '../../database/repositories/documents'
import { listFolders } from '../../database/repositories/folders'
import type { BlockNode } from '../../database/types'
import type { SerializableBlock } from '../../markdown/types'
import { serializeBlocks } from '../../markdown/serialize'
import { tiptapJsonToBlocks } from '../../markdown/tiptap-to-blocks'

export interface ToolResult {
  content: string
  error?: string
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

export function notesListDocuments(db: Database.Database, workspaceId?: string): ToolResult {
  const docs = listDocuments(db, workspaceId)
  const summary = docs.map((d) => ({
    id: d.id,
    title: d.title,
    folder_id: d.folder_id ?? null,
    updated_at: d.updated_at
  }))
  return { content: JSON.stringify(summary, null, 2) }
}

export function notesGetMarkdown(
  db: Database.Database,
  params: { document_id?: string; block_id?: string },
  workspaceId?: string
): ToolResult {
  if (!params.document_id && !params.block_id) {
    return { content: '', error: 'Either document_id or block_id must be provided' }
  }

  if (params.document_id) {
    const doc = getDocument(db, params.document_id)
    if (!doc) {
      return { content: '', error: `Document not found: ${params.document_id}` }
    }
    if (workspaceId && doc.workspace_id !== workspaceId) {
      return { content: '', error: `Document not in current workspace` }
    }

    // Prefer documents.content (TipTap JSON) — it's the authoritative source the editor uses
    let serializableBlocks: SerializableBlock[]

    if (doc.content) {
      serializableBlocks = tiptapJsonToBlocks(doc.content)
    } else {
      const tree = getBlockTree(db, params.document_id)
      serializableBlocks = tree.map(blockNodeToSerializable)
    }

    if (serializableBlocks.length === 0) {
      return { content: `# ${doc.title}\n\n(empty document)` }
    }

    const markdown = serializeBlocks(serializableBlocks)
    return { content: `# ${doc.title}\n\n${markdown}` }
  }

  // block_id case: get a single block and its children
  if (params.block_id) {
    const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(params.block_id) as
      | BlockNode
      | undefined
    if (!block) {
      return { content: '', error: `Block not found: ${params.block_id}` }
    }

    // Get the full tree of the document, then find the subtree for this block
    const tree = getBlockTree(db, block.document_id)
    const found = findBlockInTree(tree, params.block_id)
    if (!found) {
      return { content: block.content }
    }

    const serializableBlocks = [blockNodeToSerializable(found)]
    return { content: serializeBlocks(serializableBlocks) }
  }

  return { content: '', error: 'Invalid parameters' }
}

function findBlockInTree(nodes: BlockNode[], id: string): BlockNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findBlockInTree(node.children, id)
    if (found) return found
  }
  return null
}

export function notesSearch(
  db: Database.Database,
  params: { query: string },
  workspaceId?: string
): ToolResult {
  if (!params.query || params.query.trim().length === 0) {
    return { content: '', error: 'Query must not be empty' }
  }

  const sql = workspaceId
    ? `SELECT b.id, b.document_id, b.type, b.content, d.title as doc_title
       FROM blocks b
       JOIN documents d ON b.document_id = d.id
       WHERE b.content LIKE ? AND d.workspace_id = ?
       LIMIT 20`
    : `SELECT b.id, b.document_id, b.type, b.content, d.title as doc_title
       FROM blocks b
       JOIN documents d ON b.document_id = d.id
       WHERE b.content LIKE ?
       LIMIT 20`

  const blocks = (
    workspaceId
      ? db.prepare(sql).all(`%${params.query}%`, workspaceId)
      : db.prepare(sql).all(`%${params.query}%`)
  ) as Array<{
    id: string
    document_id: string
    type: string
    content: string
    doc_title: string
  }>

  if (blocks.length === 0) {
    return { content: 'No results found.' }
  }

  const results = blocks.map((b) => ({
    block_id: b.id,
    document_id: b.document_id,
    document_title: b.doc_title,
    type: b.type,
    content: b.content
  }))

  return { content: JSON.stringify(results, null, 2) }
}

export function notesGetOutline(
  db: Database.Database,
  params: { document_id: string },
  workspaceId?: string
): ToolResult {
  if (!params.document_id) {
    return { content: '', error: 'document_id is required' }
  }

  const doc = getDocument(db, params.document_id)
  if (!doc) {
    return { content: '', error: `Document not found: ${params.document_id}` }
  }
  if (workspaceId && doc.workspace_id !== workspaceId) {
    return { content: '', error: `Document not in current workspace` }
  }

  const tree = getBlockTree(db, params.document_id)
  if (tree.length === 0) {
    return { content: `# ${doc.title}\n\n(empty document)` }
  }

  const lines: string[] = [`# ${doc.title}`]
  buildOutline(tree, lines, 0)

  return { content: lines.join('\n') }
}

function buildOutline(nodes: BlockNode[], lines: string[], depth: number): void {
  for (const node of nodes) {
    const indent = '  '.repeat(depth)
    const isHeading =
      node.type === 'heading1' || node.type === 'heading2' || node.type === 'heading3'

    if (isHeading || depth === 0) {
      const prefix =
        node.type === 'heading1'
          ? '# '
          : node.type === 'heading2'
            ? '## '
            : node.type === 'heading3'
              ? '### '
              : '- '
      const contentPreview =
        node.content.length > 80 ? node.content.slice(0, 80) + '...' : node.content
      lines.push(`${indent}${prefix}${contentPreview}`)
    }

    if (node.children.length > 0) {
      buildOutline(node.children, lines, depth + 1)
    }
  }
}

export function notesListFolders(db: Database.Database, workspaceId?: string): ToolResult {
  const folders = listFolders(db, workspaceId)
  const summary = folders.map((f) => ({
    id: f.id,
    name: f.name
  }))
  return { content: JSON.stringify(summary, null, 2) }
}
