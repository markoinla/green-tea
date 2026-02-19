import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

describe('database migrations', () => {
  it('creates all expected tables on empty database', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]

    const tableNames = tables.map((t) => t.name).sort()

    expect(tableNames).toContain('documents')
    expect(tableNames).toContain('blocks')
    expect(tableNames).toContain('agent_logs')
    expect(tableNames).toContain('folders')
    expect(tableNames).toContain('workspaces')
    expect(tableNames).toContain('settings')
    expect(tableNames).toContain('workspace_files')
    expect(tableNames).toContain('conversations')
    expect(tableNames).toContain('conversation_messages')
    expect(tableNames).toContain('scheduled_tasks')
    expect(tableNames).toContain('scheduled_task_runs')
    expect(tableNames).toContain('document_versions')
  })

  it('is idempotent — running twice does not throw', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
  })

  it('creates expected indexes', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db)

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]

    const indexNames = indexes.map((i) => i.name)

    expect(indexNames).toContain('idx_blocks_document_id')
    expect(indexNames).toContain('idx_blocks_parent_block_id')
    expect(indexNames).toContain('idx_agent_logs_document_id')
    expect(indexNames).toContain('idx_conversations_workspace_id')
    expect(indexNames).toContain('idx_conversation_messages_conversation_id')
    expect(indexNames).toContain('idx_scheduled_tasks_workspace')
    expect(indexNames).toContain('idx_task_runs_task')
    expect(indexNames).toContain('idx_document_versions_doc')
    expect(indexNames).toContain('idx_document_versions_doc_time')
  })

  it('documents table has all expected columns', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db)

    const columns = db.prepare("SELECT name FROM pragma_table_info('documents')").all() as {
      name: string
    }[]
    const colNames = columns.map((c) => c.name)

    expect(colNames).toContain('id')
    expect(colNames).toContain('title')
    expect(colNames).toContain('content')
    expect(colNames).toContain('workspace_id')
    expect(colNames).toContain('folder_id')
  })
})
