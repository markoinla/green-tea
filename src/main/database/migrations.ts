import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      project_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      parent_block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'paragraph',
      content TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      collapsed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS agent_logs (
      id TEXT PRIMARY KEY,
      document_id TEXT REFERENCES documents(id),
      block_id TEXT REFERENCES blocks(id),
      agent_name TEXT NOT NULL,
      action_type TEXT NOT NULL,
      input_markdown TEXT,
      output_patch TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_document_id ON blocks(document_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_parent_block_id ON blocks(parent_block_id);
    CREATE INDEX IF NOT EXISTS idx_agent_logs_document_id ON agent_logs(document_id);
  `)

  // Migration: add content column for storing TipTap editor JSON
  const hasContentCol = db
    .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('documents') WHERE name = 'content'")
    .get() as { cnt: number }

  if (hasContentCol.cnt === 0) {
    db.exec('ALTER TABLE documents ADD COLUMN content TEXT')
  }

  // Migration: create folders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      collapsed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Migration: add folder_id column to documents
  const hasFolderIdCol = db
    .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('documents') WHERE name = 'folder_id'")
    .get() as { cnt: number }

  if (hasFolderIdCol.cnt === 0) {
    db.exec(
      'ALTER TABLE documents ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL'
    )
  }

  // Migration: create workspaces table
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Migration: add workspace_id to documents and folders
  const hasWorkspaceIdDoc = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('documents') WHERE name = 'workspace_id'"
    )
    .get() as { cnt: number }

  if (hasWorkspaceIdDoc.cnt === 0) {
    // Create default workspace
    const defaultId = randomUUID()
    db.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)').run(defaultId, 'Default')

    // Add workspace_id to documents
    db.exec('ALTER TABLE documents ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)')
    db.prepare('UPDATE documents SET workspace_id = ?').run(defaultId)

    // Add workspace_id to folders
    db.exec('ALTER TABLE folders ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)')
    db.prepare('UPDATE folders SET workspace_id = ?').run(defaultId)
  }

  // Migration: create settings table (key-value store)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // Migration: create workspace_files table (file path references)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_files (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workspace_id, file_path)
    )
  `)

  // Migration: create conversations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Migration: create conversation_messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      thinking TEXT,
      tool_name TEXT,
      tool_args TEXT,
      tool_call_id TEXT,
      tool_result TEXT,
      tool_is_error INTEGER NOT NULL DEFAULT 0,
      patch_log_id TEXT,
      patch_diff TEXT,
      patch_document_id TEXT,
      images TEXT,
      files TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_workspace_id ON conversations(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id ON conversation_messages(conversation_id);
  `)

  // Migration: add memory column to workspaces
  const hasMemoryCol = db
    .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('workspaces') WHERE name = 'memory'")
    .get() as { cnt: number }

  if (hasMemoryCol.cnt === 0) {
    db.exec("ALTER TABLE workspaces ADD COLUMN memory TEXT NOT NULL DEFAULT ''")
  }

  // Migration: create scheduled_tasks and scheduled_task_runs tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      last_run_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_workspace
      ON scheduled_tasks(workspace_id);
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      result TEXT,
      tokens_used INTEGER,
      error_message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_task_runs_task
      ON scheduled_task_runs(task_id);
  `)

  // Migration: add tokens_used column to scheduled_task_runs
  const hasTokensCol = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('scheduled_task_runs') WHERE name = 'tokens_used'"
    )
    .get() as { cnt: number }

  if (hasTokensCol.cnt === 0) {
    db.exec('ALTER TABLE scheduled_task_runs ADD COLUMN tokens_used INTEGER')
  }

  // Migration: add next_run_at column to scheduled_tasks
  const hasNextRunAtCol = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('scheduled_tasks') WHERE name = 'next_run_at'"
    )
    .get() as { cnt: number }

  if (hasNextRunAtCol.cnt === 0) {
    db.exec('ALTER TABLE scheduled_tasks ADD COLUMN next_run_at TEXT')
  }

  // Migration: add old_text / new_text columns to agent_logs for targeted patch application
  const hasOldTextCol = db
    .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('agent_logs') WHERE name = 'old_text'")
    .get() as { cnt: number }

  if (hasOldTextCol.cnt === 0) {
    db.exec('ALTER TABLE agent_logs ADD COLUMN old_text TEXT')
    db.exec('ALTER TABLE agent_logs ADD COLUMN new_text TEXT')
  }

  // Migration: create document_versions table for note version history
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT,
      source TEXT NOT NULL DEFAULT 'autosave',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_document_versions_doc ON document_versions(document_id);
    CREATE INDEX IF NOT EXISTS idx_document_versions_doc_time ON document_versions(document_id, created_at DESC);
  `)
}
