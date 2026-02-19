import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../__test__/setup'
import { listAgentLogs, createAgentLog, updateAgentLogStatus } from './agent-logs'
import { createDocument } from './documents'
import { createWorkspace } from './workspaces'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

describe('agent-logs repository', () => {
  function setup() {
    const ws = createWorkspace(db, { name: 'Test' })
    const doc = createDocument(db, { title: 'Doc', workspace_id: ws.id })
    return { ws, doc }
  }

  it('creates and lists agent logs', () => {
    const { doc } = setup()
    const log = createAgentLog(db, {
      document_id: doc.id,
      agent_name: 'test-agent',
      action_type: 'edit',
      input_markdown: '# Hello',
      output_patch: '@@ patch @@'
    })

    expect(log.agent_name).toBe('test-agent')
    expect(log.action_type).toBe('edit')
    expect(log.status).toBe('pending')
    expect(log.input_markdown).toBe('# Hello')

    const logs = listAgentLogs(db)
    expect(logs.length).toBe(1)
  })

  it('filters by document_id', () => {
    const { doc } = setup()
    createAgentLog(db, { document_id: doc.id, agent_name: 'a', action_type: 'edit' })
    createAgentLog(db, { agent_name: 'b', action_type: 'other' })

    const filtered = listAgentLogs(db, { document_id: doc.id })
    expect(filtered.length).toBe(1)
    expect(filtered[0].agent_name).toBe('a')
  })

  it('filters by status', () => {
    const { doc } = setup()
    const log = createAgentLog(db, {
      document_id: doc.id,
      agent_name: 'a',
      action_type: 'edit'
    })
    updateAgentLogStatus(db, log.id, 'applied')

    const pending = listAgentLogs(db, { status: 'pending' })
    expect(pending.length).toBe(0)

    const applied = listAgentLogs(db, { status: 'applied' })
    expect(applied.length).toBe(1)
  })

  it('filters by both document_id and status', () => {
    const { doc } = setup()
    const log1 = createAgentLog(db, {
      document_id: doc.id,
      agent_name: 'a',
      action_type: 'edit'
    })
    createAgentLog(db, { document_id: doc.id, agent_name: 'b', action_type: 'edit' })
    updateAgentLogStatus(db, log1.id, 'applied')

    const filtered = listAgentLogs(db, { document_id: doc.id, status: 'applied' })
    expect(filtered.length).toBe(1)
    expect(filtered[0].agent_name).toBe('a')
  })

  it('updates agent log status', () => {
    const { doc } = setup()
    const log = createAgentLog(db, {
      document_id: doc.id,
      agent_name: 'test',
      action_type: 'edit'
    })

    const updated = updateAgentLogStatus(db, log.id, 'rejected')
    expect(updated.status).toBe('rejected')
  })

  it('throws when updating nonexistent log', () => {
    expect(() => updateAgentLogStatus(db, 'nope', 'applied')).toThrow('Agent log not found')
  })

  it('stores old_text and new_text', () => {
    const { doc } = setup()
    const log = createAgentLog(db, {
      document_id: doc.id,
      agent_name: 'test',
      action_type: 'edit',
      old_text: 'old content',
      new_text: 'new content'
    })

    expect(log.old_text).toBe('old content')
    expect(log.new_text).toBe('new content')
  })
})
