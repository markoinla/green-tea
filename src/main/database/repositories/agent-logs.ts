import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { AgentLog } from '../types'

export function listAgentLogs(
  db: Database.Database,
  filter?: { document_id?: string; status?: string }
): AgentLog[] {
  let query = 'SELECT * FROM agent_logs'
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter?.document_id) {
    conditions.push('document_id = ?')
    params.push(filter.document_id)
  }
  if (filter?.status) {
    conditions.push('status = ?')
    params.push(filter.status)
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }

  query += ' ORDER BY created_at DESC'

  return db.prepare(query).all(...params) as AgentLog[]
}

export function createAgentLog(
  db: Database.Database,
  data: {
    document_id?: string
    block_id?: string
    agent_name: string
    action_type: string
    input_markdown?: string
    output_patch?: string
    old_text?: string
    new_text?: string
  }
): AgentLog {
  const id = randomUUID()
  db.prepare(
    'INSERT INTO agent_logs (id, document_id, block_id, agent_name, action_type, input_markdown, output_patch, old_text, new_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.document_id ?? null,
    data.block_id ?? null,
    data.agent_name,
    data.action_type,
    data.input_markdown ?? null,
    data.output_patch ?? null,
    data.old_text ?? null,
    data.new_text ?? null
  )
  return db.prepare('SELECT * FROM agent_logs WHERE id = ?').get(id) as AgentLog
}

export function updateAgentLogStatus(db: Database.Database, id: string, status: string): AgentLog {
  const log = db.prepare('SELECT * FROM agent_logs WHERE id = ?').get(id) as AgentLog | undefined
  if (!log) throw new Error(`Agent log not found: ${id}`)

  db.prepare('UPDATE agent_logs SET status = ? WHERE id = ?').run(status, id)
  return db.prepare('SELECT * FROM agent_logs WHERE id = ?').get(id) as AgentLog
}
