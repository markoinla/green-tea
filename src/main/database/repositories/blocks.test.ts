import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../__test__/setup'
import { getBlockTree, getBlock, createBlock, updateBlock, deleteBlock, moveBlock } from './blocks'
import { createDocument } from './documents'
import { createWorkspace } from './workspaces'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

function setup() {
  const ws = createWorkspace(db, { name: 'Test' })
  const doc = createDocument(db, { title: 'Doc', workspace_id: ws.id })
  return { ws, doc }
}

describe('blocks repository', () => {
  it('creates and retrieves a block', () => {
    const { doc } = setup()
    const block = createBlock(db, { document_id: doc.id, content: 'Hello' })
    expect(block.content).toBe('Hello')
    expect(block.type).toBe('paragraph')
    expect(block.document_id).toBe(doc.id)

    const fetched = getBlock(db, block.id)
    expect(fetched).toBeDefined()
    expect(fetched!.content).toBe('Hello')
  })

  it('builds a block tree with parent-child relationships', () => {
    const { doc } = setup()
    const parent = createBlock(db, { document_id: doc.id, content: 'Parent', position: 0 })
    createBlock(db, {
      document_id: doc.id,
      parent_block_id: parent.id,
      content: 'Child 1',
      position: 0
    })
    createBlock(db, {
      document_id: doc.id,
      parent_block_id: parent.id,
      content: 'Child 2',
      position: 1
    })

    const tree = getBlockTree(db, doc.id)
    expect(tree.length).toBe(1)
    expect(tree[0].content).toBe('Parent')
    expect(tree[0].children.length).toBe(2)
    expect(tree[0].children[0].content).toBe('Child 1')
    expect(tree[0].children[1].content).toBe('Child 2')
  })

  it('children are ordered by position', () => {
    const { doc } = setup()
    const parent = createBlock(db, { document_id: doc.id, content: 'Parent', position: 0 })
    createBlock(db, {
      document_id: doc.id,
      parent_block_id: parent.id,
      content: 'Second',
      position: 1
    })
    createBlock(db, {
      document_id: doc.id,
      parent_block_id: parent.id,
      content: 'First',
      position: 0
    })

    const tree = getBlockTree(db, doc.id)
    expect(tree[0].children[0].content).toBe('First')
    expect(tree[0].children[1].content).toBe('Second')
  })

  it('updates a block', () => {
    const { doc } = setup()
    const block = createBlock(db, { document_id: doc.id, content: 'Old' })
    const updated = updateBlock(db, block.id, { content: 'New', type: 'heading1' })
    expect(updated.content).toBe('New')
    expect(updated.type).toBe('heading1')
  })

  it('throws when updating nonexistent block', () => {
    expect(() => updateBlock(db, 'nope', { content: 'X' })).toThrow('Block not found')
  })

  it('deleteBlock cascades to children', () => {
    const { doc } = setup()
    const parent = createBlock(db, { document_id: doc.id, content: 'Parent' })
    const child = createBlock(db, {
      document_id: doc.id,
      parent_block_id: parent.id,
      content: 'Child'
    })

    deleteBlock(db, parent.id)

    expect(getBlock(db, parent.id)).toBeUndefined()
    expect(getBlock(db, child.id)).toBeUndefined()
  })

  it('moveBlock changes parent and position', () => {
    const { doc } = setup()
    const p1 = createBlock(db, { document_id: doc.id, content: 'Parent 1', position: 0 })
    const p2 = createBlock(db, { document_id: doc.id, content: 'Parent 2', position: 1 })
    const child = createBlock(db, {
      document_id: doc.id,
      parent_block_id: p1.id,
      content: 'Child',
      position: 0
    })

    moveBlock(db, child.id, { parent_block_id: p2.id, position: 5 })

    const moved = getBlock(db, child.id)!
    expect(moved.parent_block_id).toBe(p2.id)
    expect(moved.position).toBe(5)
  })

  it('throws when moving nonexistent block', () => {
    expect(() => moveBlock(db, 'nope', { position: 0 })).toThrow('Block not found')
  })
})
