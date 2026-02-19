import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { Conversation, ConversationMessage } from '../types'

export function listConversations(db: Database.Database, workspaceId: string): Conversation[] {
  return db
    .prepare('SELECT * FROM conversations WHERE workspace_id = ? ORDER BY updated_at DESC')
    .all(workspaceId) as Conversation[]
}

export function getConversation(db: Database.Database, id: string): Conversation | undefined {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined
}

export function createConversation(
  db: Database.Database,
  data: { workspace_id: string; title?: string }
): Conversation {
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO conversations (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, data.workspace_id, data.title ?? null, now, now)
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation
}

export function updateConversationTitle(
  db: Database.Database,
  id: string,
  title: string
): Conversation {
  const now = new Date().toISOString()
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, now, id)
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation
}

export function deleteConversation(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function countConversations(db: Database.Database, workspaceId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM conversations WHERE workspace_id = ?')
    .get(workspaceId) as { cnt: number }
  return row.cnt
}

export function listConversationMessages(
  db: Database.Database,
  conversationId: string
): ConversationMessage[] {
  return db
    .prepare(
      'SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC'
    )
    .all(conversationId) as ConversationMessage[]
}

export function addConversationMessage(
  db: Database.Database,
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
): ConversationMessage {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO conversation_messages
      (id, conversation_id, role, content, thinking, tool_name, tool_args, tool_call_id, tool_result, tool_is_error, patch_log_id, patch_diff, patch_document_id, images, files)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.conversation_id,
    data.role,
    data.content,
    data.thinking ?? null,
    data.tool_name ?? null,
    data.tool_args ?? null,
    data.tool_call_id ?? null,
    data.tool_result ?? null,
    data.tool_is_error ? 1 : 0,
    data.patch_log_id ?? null,
    data.patch_diff ?? null,
    data.patch_document_id ?? null,
    data.images ?? null,
    data.files ?? null
  )
  return db
    .prepare('SELECT * FROM conversation_messages WHERE id = ?')
    .get(id) as ConversationMessage
}

export function updateConversationMessage(
  db: Database.Database,
  id: string,
  data: {
    content?: string
    thinking?: string
    tool_result?: string
    tool_is_error?: boolean
  }
): void {
  const sets: string[] = []
  const values: unknown[] = []

  if (data.content !== undefined) {
    sets.push('content = ?')
    values.push(data.content)
  }
  if (data.thinking !== undefined) {
    sets.push('thinking = ?')
    values.push(data.thinking)
  }
  if (data.tool_result !== undefined) {
    sets.push('tool_result = ?')
    values.push(data.tool_result)
  }
  if (data.tool_is_error !== undefined) {
    sets.push('tool_is_error = ?')
    values.push(data.tool_is_error ? 1 : 0)
  }

  if (sets.length === 0) return

  values.push(id)
  db.prepare(`UPDATE conversation_messages SET ${sets.join(', ')} WHERE id = ?`).run(...values)
}

export function deleteConversationMessages(db: Database.Database, conversationId: string): void {
  db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?').run(conversationId)
}
