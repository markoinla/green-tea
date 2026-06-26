import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Default base dir for workspace folders, mirrored from `agent/paths.ts`
 * (DEFAULT_BASE_DIR). Duplicated here so the migration has no runtime dependency
 * on the agent layer. Backfill targets `<base>/<sanitized-name>/`.
 */
const DEFAULT_BASE_DIR = join(homedir(), 'Documents', 'Green Tea')

/** Mirror of `sanitizeWorkspaceName` in `agent/paths.ts` for the path backfill. */
function sanitizeWorkspaceName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'default'
  )
}

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

  // Migration: add file_path to documents. With markdown-on-disk, the .md file
  // is the source of truth and the documents row becomes a derived index; this
  // column maps an index row to its file. (content is kept as a transitional
  // mirror so agent tools / versions keep working until they move to files.)
  const hasFilePathCol = db
    .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('documents') WHERE name = 'file_path'")
    .get() as { cnt: number }

  if (hasFilePathCol.cnt === 0) {
    db.exec('ALTER TABLE documents ADD COLUMN file_path TEXT')
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

  // Migration: note metadata (frontmatter properties). The .md frontmatter stays
  // the source of truth; these columns/tables are a derived, queryable index.
  // documents.frontmatter caches the parsed frontmatter JSON (fidelity cache +
  // change-detection fingerprint).
  const hasFrontmatterCol = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('documents') WHERE name = 'frontmatter'"
    )
    .get() as { cnt: number }

  if (hasFrontmatterCol.cnt === 0) {
    db.exec('ALTER TABLE documents ADD COLUMN frontmatter TEXT')
  }

  // EAV query substrate. No PRIMARY KEY / UNIQUE: list elements may legitimately
  // repeat. Integrity is guaranteed by the invariant that every write re-derives
  // a note's rows in a single transaction (delete-by-document_id then reinsert).
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_properties (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      value_fold TEXT NOT NULL,
      value_type TEXT NOT NULL,
      conforms INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_docprops_key_fold ON document_properties(key, value_fold);
    CREATE INDEX IF NOT EXISTS idx_docprops_doc ON document_properties(document_id);
  `)

  // Per-workspace property type registry (auto-seeded; user override authoritative).
  db.exec(`
    CREATE TABLE IF NOT EXISTS property_types (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      type TEXT NOT NULL,
      user_set INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, key)
    )
  `)

  // Migration: add metadata_payload to agent_logs (Phase 5, C3 batching). A
  // metadata proposal can target many notes at once, which the one-row-per-edit
  // old_text/new_text columns can't express. This column holds a JSON array of
  // { document_id, changedKeys } applied by iterating updateFrontmatter; the row's
  // action_type is 'propose_metadata' so the apply path can branch on it.
  const hasMetadataPayloadCol = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('agent_logs') WHERE name = 'metadata_payload'"
    )
    .get() as { cnt: number }

  if (hasMetadataPayloadCol.cnt === 0) {
    db.exec('ALTER TABLE agent_logs ADD COLUMN metadata_payload TEXT')
  }

  // Migration: add metadata_* columns to conversation_messages so a metadata
  // approval card can be persisted/rehydrated like the patch_* columns are.
  const hasConvMetadataCol = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('conversation_messages') WHERE name = 'metadata_log_id'"
    )
    .get() as { cnt: number }

  if (hasConvMetadataCol.cnt === 0) {
    db.exec('ALTER TABLE conversation_messages ADD COLUMN metadata_log_id TEXT')
    db.exec('ALTER TABLE conversation_messages ADD COLUMN metadata_payload TEXT')
  }

  // Migration: add `path` to workspaces. A workspace is now a folder anywhere on
  // disk (Obsidian-style); the path is the source of truth for resolving the
  // workspace dir. Backfill existing rows to the default flat location
  // `~/Documents/Green Tea/<sanitized-name>/` (e.g. the seeded Default workspace
  // → `~/Documents/Green Tea/Default/`).
  const hasWorkspacePathCol = db
    .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('workspaces') WHERE name = 'path'")
    .get() as { cnt: number }

  if (hasWorkspacePathCol.cnt === 0) {
    db.exec("ALTER TABLE workspaces ADD COLUMN path TEXT NOT NULL DEFAULT ''")
    const rows = db.prepare('SELECT id, name FROM workspaces').all() as {
      id: string
      name: string
    }[]
    const setPath = db.prepare('UPDATE workspaces SET path = ? WHERE id = ?')
    for (const row of rows) {
      setPath.run(join(DEFAULT_BASE_DIR, sanitizeWorkspaceName(row.name)), row.id)
    }
  }

  // Migration: share links (M2). A local index of published shares. Keyed on the
  // STABLE on-disk document identity (`doc_key`) — a note's frontmatter UUID, or
  // an artifact's workspace-relative path — NOT `documents.id`, which is a
  // disposable cache that is rebuilt from disk on every reindex (and regenerated
  // for artifacts on rename or DB wipe). Deliberately NO foreign key to
  // documents(id): this row must outlive a documents row that gets dropped and
  // recreated by reindex. reindex never touches this table, so a share survives
  // restart and reindex; it only vanishes on a full greentea.db deletion (at
  // which point the identities are gone too and re-publishing is correct).
  // UNIQUE(doc_key) enforces one live share per document; re-publish overwrites
  // in place (the previously-stored slug is reused for a stable public URL).
  db.exec(`
    CREATE TABLE IF NOT EXISTS shares (
      slug TEXT PRIMARY KEY,
      doc_key TEXT NOT NULL,
      workspace_id TEXT,
      file_path TEXT,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_doc_key ON shares(doc_key);
  `)
}
