import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../__test__/setup'
import {
  listConversations,
  getConversation,
  createConversation,
  updateConversationTitle,
  deleteConversation,
  countConversations,
  listConversationMessages,
  addConversationMessage,
  updateConversationMessage,
  deleteConversationMessages
} from './conversations'
import { createWorkspace } from './workspaces'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

function makeWorkspace() {
  return createWorkspace(db, { name: 'Test' })
}

describe('conversations repository', () => {
  it('creates and retrieves a conversation', () => {
    const ws = makeWorkspace()
    const conv = createConversation(db, { workspace_id: ws.id, title: 'Chat 1' })
    expect(conv.title).toBe('Chat 1')
    expect(conv.workspace_id).toBe(ws.id)

    const fetched = getConversation(db, conv.id)
    expect(fetched).toBeDefined()
    expect(fetched!.title).toBe('Chat 1')
  })

  it('lists conversations ordered by updated_at DESC', () => {
    const ws = makeWorkspace()
    const older = createConversation(db, { workspace_id: ws.id, title: 'Older' })
    const newer = createConversation(db, { workspace_id: ws.id, title: 'Newer' })

    // Manually set different updated_at to guarantee ordering
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
      '2025-01-01T00:00:00.000Z',
      older.id
    )
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
      '2025-01-02T00:00:00.000Z',
      newer.id
    )

    const list = listConversations(db, ws.id)
    expect(list.length).toBe(2)
    expect(list[0].id).toBe(newer.id)
  })

  it('updates conversation title', () => {
    const ws = makeWorkspace()
    const conv = createConversation(db, { workspace_id: ws.id, title: 'Old' })
    const updated = updateConversationTitle(db, conv.id, 'New Title')
    expect(updated.title).toBe('New Title')
  })

  it('deletes a conversation and cascades messages', () => {
    const ws = makeWorkspace()
    const conv = createConversation(db, { workspace_id: ws.id })
    addConversationMessage(db, {
      conversation_id: conv.id,
      role: 'user',
      content: 'Hello'
    })

    deleteConversation(db, conv.id)

    expect(getConversation(db, conv.id)).toBeUndefined()
    const msgs = listConversationMessages(db, conv.id)
    expect(msgs.length).toBe(0)
  })

  it('counts conversations', () => {
    const ws = makeWorkspace()
    expect(countConversations(db, ws.id)).toBe(0)
    createConversation(db, { workspace_id: ws.id })
    createConversation(db, { workspace_id: ws.id })
    expect(countConversations(db, ws.id)).toBe(2)
  })
})

describe('conversation messages', () => {
  it('adds and lists messages ordered by created_at ASC', () => {
    const ws = makeWorkspace()
    const conv = createConversation(db, { workspace_id: ws.id })

    addConversationMessage(db, { conversation_id: conv.id, role: 'user', content: 'Hi' })
    addConversationMessage(db, { conversation_id: conv.id, role: 'assistant', content: 'Hello!' })

    const msgs = listConversationMessages(db, conv.id)
    expect(msgs.length).toBe(2)
    expect(msgs[0].role).toBe('user')
    expect(msgs[1].role).toBe('assistant')
  })

  it('stores tool fields', () => {
    const ws = makeWorkspace()
    const conv = createConversation(db, { workspace_id: ws.id })

    const msg = addConversationMessage(db, {
      conversation_id: conv.id,
      role: 'assistant',
      content: '',
      thinking: 'Let me think...',
      tool_name: 'notes_list',
      tool_args: '{"workspace_id": "123"}',
      patch_diff: '@@ -1 +1 @@'
    })

    expect(msg.thinking).toBe('Let me think...')
    expect(msg.tool_name).toBe('notes_list')
    expect(msg.tool_args).toBe('{"workspace_id": "123"}')
    expect(msg.patch_diff).toBe('@@ -1 +1 @@')
  })

  it('updates message fields', () => {
    const ws = makeWorkspace()
    const conv = createConversation(db, { workspace_id: ws.id })
    const msg = addConversationMessage(db, {
      conversation_id: conv.id,
      role: 'assistant',
      content: 'old'
    })

    updateConversationMessage(db, msg.id, { content: 'new', tool_is_error: true })

    const msgs = listConversationMessages(db, conv.id)
    expect(msgs[0].content).toBe('new')
    expect(msgs[0].tool_is_error).toBe(1)
  })

  it('deleteConversationMessages removes all messages', () => {
    const ws = makeWorkspace()
    const conv = createConversation(db, { workspace_id: ws.id })
    addConversationMessage(db, { conversation_id: conv.id, role: 'user', content: 'A' })
    addConversationMessage(db, { conversation_id: conv.id, role: 'user', content: 'B' })

    deleteConversationMessages(db, conv.id)

    const msgs = listConversationMessages(db, conv.id)
    expect(msgs.length).toBe(0)
  })
})
