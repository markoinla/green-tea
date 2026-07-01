import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getWorkspaceVaultDir } from '../vault/paths'
import {
  WORKSPACE_DESCRIPTION_FILE,
  WORKSPACE_MEMORY_FILE,
  writeWorkspaceDoc
} from '../vault/workspace-docs'

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
    db.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)').run(defaultId, 'Green Tea Workspace')

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

  // Migration: drop the legacy document_versions table. Per-note + vault history is
  // now git-backed (src/main/git/), so the SQLite quick-undo layer is retired.
  // Dropping the table also removes its indexes.
  db.exec('DROP TABLE IF EXISTS document_versions;')

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

  // Migration: full-text search + link graph (both derived indexes). No backfill —
  // the unconditional startup reindexAllWorkspaces repopulates title_fold,
  // note_links, and notes_fts from disk on first launch.

  // documents.title_fold — fold(title) as the Unicode-correct title-join key for
  // backlink/outgoing-link resolution (SQL lower() only folds ASCII).
  const hasTitleFoldCol = db
    .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('documents') WHERE name = 'title_fold'")
    .get() as { cnt: number }

  if (hasTitleFoldCol.cnt === 0) {
    db.exec('ALTER TABLE documents ADD COLUMN title_fold TEXT')
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_documents_ws_titlefold ON documents(workspace_id, title_fold)'
  )

  // note_links — persisted wiki-link edges (the knowledge-graph data layer). One
  // row per (source_id, label_fold); notes only. No FK to documents (deliberate —
  // rows are pruned by reindexDerived / deleteIndexRow, mirroring the rebuild model).
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_links (
      source_id    TEXT NOT NULL,
      target_label TEXT NOT NULL,
      label_fold   TEXT NOT NULL,
      snippet      TEXT NOT NULL,
      workspace_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_id);
    CREATE INDEX IF NOT EXISTS idx_note_links_lookup ON note_links(workspace_id, label_fold);
  `)

  // notes_fts — standalone FTS5 over note title + body (artifacts: title only,
  // body=''). Maintained delete+insert per row by id.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title,
      body,
      id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2',
      prefix = '2 3 4'
    )
  `)

  // Migration: encrypted secrets store (Phase 00, §4.9). A dedicated, namespaced
  // table for secrets (OAuth refresh tokens, plugin secrets) so they NEVER leak
  // through the dumpable `db:settings:*` IPC. `value` holds Electron safeStorage
  // ciphertext as a BLOB; `encrypted` records the encoding (1 = safeStorage,
  // 0 = plaintext fallback when no secure backend is available) so reads can
  // branch on it. This is SCHEMA ONLY — safeStorage.encryptString is never called
  // from runMigrations (it requires app 'ready'); the data migration runs later
  // inside app.whenReady(). The secrets table is excluded from any reset/rebuild
  // path: safeStorage ciphertext is device-bound, so secrets are per-device.
  db.exec(`
    CREATE TABLE IF NOT EXISTS secrets (
      key TEXT PRIMARY KEY,
      value BLOB,
      encrypted INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Migration: add per-task provider/model override to scheduled_tasks. NULL means
  // "use the app's current model setting" (the prior behavior), so existing tasks
  // keep working unchanged. When set, the executor builds the model from these
  // instead of the global aiProvider/*Model settings (see getModelConfig override).
  const hasProviderCol = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM pragma_table_info('scheduled_tasks') WHERE name = 'provider'"
    )
    .get() as { cnt: number }

  if (hasProviderCol.cnt === 0) {
    db.exec('ALTER TABLE scheduled_tasks ADD COLUMN provider TEXT')
    db.exec('ALTER TABLE scheduled_tasks ADD COLUMN model TEXT')
  }

  // Per-document VIEW-STATE for the table artifact (column widths + sort): local,
  // volatile UI state that deliberately does NOT live on disk (unlike the schema
  // sidecar) so its churn never touches git or sync. Keyed by the artifact's
  // document id; FK CASCADE (foreign_keys=ON, see connection.ts) drops the row
  // when the document is deleted. `view_state` is an opaque JSON blob owned by the
  // renderer. Excluded from the rebuild model — it's losable (a DB wipe takes the
  // widths with it, which is acceptable for view-state).
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_view_state (
      document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      view_state TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

/**
 * One-time backfill of the on-disk workspace docs (`README.md` / `MEMORY.md`)
 * from the legacy `workspaces.description` /
 * `workspaces.memory` columns. Files are now the source of truth (see
 * `vault/workspace-docs.ts`); the columns are kept this release as a vestigial
 * safety net and dropped in a follow-up. Guarded by a one-shot settings flag so
 * the backfill runs AT MOST ONCE — running it on every startup would resurrect
 * memory a user deliberately deleted (a file-absent check alone can't distinguish
 * "never migrated" from "deleted to forget"). Per workspace: write a file only
 * when its column is non-empty AND the workspace folder EXISTS AND the file is
 * ABSENT — never overwrite, never mkdir a missing/unavailable workspace folder
 * back. writeWorkspaceDoc routes through markSelfWrite + atomicWriteFile so the
 * vault watcher never echoes.
 *
 * IMPORTANT: this MUST run AFTER the legacy `vaults/` -> `workspaces/` layout
 * move and ensureUserDirs (so path-derived workspace folders are already at their
 * final location), otherwise `existsSync(dir)` would skip them while the one-shot
 * flag is set, permanently stranding their description/memory. It is therefore
 * invoked from the startup sequence, NOT from `runMigrations` (which runs inside
 * getDatabase, before the layout move).
 */
export function backfillWorkspaceDocs(db: Database.Database): void {
  const BACKFILL_FLAG = 'migration:workspace_docs_backfill_done'
  const backfillDone = db.prepare('SELECT value FROM settings WHERE key = ?').get(BACKFILL_FLAG) as
    | { value: string }
    | undefined
  if (backfillDone) return

  const wsRows = db.prepare('SELECT id, description, memory FROM workspaces').all() as {
    id: string
    description: string | null
    memory: string | null
  }[]
  for (const ws of wsRows) {
    const dir = getWorkspaceVaultDir(db, ws.id)
    if (!existsSync(dir)) continue
    const description = ws.description ?? ''
    const memory = ws.memory ?? ''
    if (description && !existsSync(join(dir, WORKSPACE_DESCRIPTION_FILE))) {
      writeWorkspaceDoc(db, ws.id, 'description', description)
    }
    if (memory && !existsSync(join(dir, WORKSPACE_MEMORY_FILE))) {
      writeWorkspaceDoc(db, ws.id, 'memory', memory)
    }
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(BACKFILL_FLAG, '1')
}
