import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { Block, BlockNode } from '../types'

export function getBlockTree(db: Database.Database, documentId: string): BlockNode[] {
  const blocks = db
    .prepare('SELECT * FROM blocks WHERE document_id = ? ORDER BY position ASC')
    .all(documentId) as Block[]

  const blockMap = new Map<string, BlockNode>()
  for (const block of blocks) {
    blockMap.set(block.id, { ...block, children: [] })
  }

  const roots: BlockNode[] = []
  for (const node of blockMap.values()) {
    if (node.parent_block_id && blockMap.has(node.parent_block_id)) {
      blockMap.get(node.parent_block_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

export function getBlock(db: Database.Database, id: string): Block | undefined {
  return db.prepare('SELECT * FROM blocks WHERE id = ?').get(id) as Block | undefined
}

export function createBlock(
  db: Database.Database,
  data: {
    document_id: string
    parent_block_id?: string
    type?: string
    content?: string
    position?: number
  }
): Block {
  const id = randomUUID()
  db.prepare(
    'INSERT INTO blocks (id, document_id, parent_block_id, type, content, position) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.document_id,
    data.parent_block_id ?? null,
    data.type ?? 'paragraph',
    data.content ?? '',
    data.position ?? 0
  )
  return getBlock(db, id)!
}

export function updateBlock(
  db: Database.Database,
  id: string,
  data: { type?: string; content?: string; collapsed?: number; position?: number }
): Block {
  const block = getBlock(db, id)
  if (!block) throw new Error(`Block not found: ${id}`)

  const type = data.type ?? block.type
  const content = data.content ?? block.content
  const collapsed = data.collapsed ?? block.collapsed
  const position = data.position ?? block.position

  db.prepare(
    'UPDATE blocks SET type = ?, content = ?, collapsed = ?, position = ? WHERE id = ?'
  ).run(type, content, collapsed, position, id)

  return getBlock(db, id)!
}

export function deleteBlock(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM blocks WHERE id = ?').run(id)
}

export function moveBlock(
  db: Database.Database,
  id: string,
  data: { parent_block_id?: string; position: number }
): void {
  const block = getBlock(db, id)
  if (!block) throw new Error(`Block not found: ${id}`)

  const parentId = data.parent_block_id !== undefined ? data.parent_block_id : block.parent_block_id

  db.prepare('UPDATE blocks SET parent_block_id = ?, position = ? WHERE id = ?').run(
    parentId ?? null,
    data.position,
    id
  )
}
