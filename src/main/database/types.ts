/**
 * A document's kind, derived from its backing file's extension. `'note'` is the
 * markdown editor path; any other value is a rendered artifact. The extension→
 * kind mapping (and the helpers) live in `../vault/artifact-kinds`; the type is
 * defined HERE so the renderer can import it without pulling in node-only code.
 */
export type BuiltinDocumentKind = 'note' | 'html' | 'csv' | 'image' | 'pdf' | 'canvas'

/**
 * A document's kind. Either one of the built-in kinds, or a namespaced plugin
 * artifact kind (`plugin:<pluginId>:<kind>`, see `pluginKind`). Plugin kinds are
 * always artifacts (never `'note'`).
 */
export type DocumentKind = BuiltinDocumentKind | `plugin:${string}`

export interface Document {
  id: string
  title: string
  content: string | null
  workspace_id: string
  folder_id: string | null
  /** Absolute path to the backing file (markdown-on-disk index, or an artifact). */
  file_path?: string | null
  created_at: string
  updated_at: string
  /** Parsed frontmatter (note metadata) from the backing .md file. */
  frontmatter?: Record<string, unknown>
  /**
   * Derived from the backing file's extension (v2). `'note'` is the genuine
   * markdown editor path; any other value is a rendered artifact (`content` is
   * null, opened in a kind-specific viewer). Derived in `rowToDocument`, so every
   * read path carries it.
   */
  kind?: DocumentKind
}

export interface Folder {
  id: string
  name: string
  workspace_id: string
  collapsed: number
  created_at: string
  updated_at: string
}

export interface Workspace {
  id: string
  name: string
  description: string
  memory: string
  /**
   * Absolute path to the workspace's folder on disk (Obsidian-style: a workspace
   * *is* a folder). The whole tree is the document set; a hidden `.greentea/`
   * holds agent scratch. Backfilled for legacy workspaces to the default location
   * `~/Documents/Green Tea/<sanitized-name>/`.
   */
  path: string
  created_at: string
  updated_at: string
}

export interface Block {
  id: string
  document_id: string
  parent_block_id: string | null
  type: string
  content: string
  position: number
  collapsed: number
}

export interface BlockNode extends Block {
  children: BlockNode[]
}

export interface AgentLog {
  id: string
  document_id: string | null
  block_id: string | null
  agent_name: string
  action_type: string
  input_markdown: string | null
  output_patch: string | null
  old_text: string | null
  new_text: string | null
  /**
   * Metadata-proposal payload (Phase 5): JSON array of
   * `{ document_id, changedKeys }` for `action_type='propose_metadata'`. Null for
   * markdown patches.
   */
  metadata_payload: string | null
  status: string
  created_at: string
}

export interface WorkspaceFile {
  id: string
  workspace_id: string
  file_path: string
  file_name: string
  created_at: string
}

export interface Conversation {
  id: string
  workspace_id: string
  title: string | null
  created_at: string
  updated_at: string
}

export interface ConversationMessage {
  id: string
  conversation_id: string
  role: string
  content: string
  thinking: string | null
  tool_name: string | null
  tool_args: string | null
  tool_call_id: string | null
  tool_result: string | null
  tool_is_error: number
  patch_log_id: string | null
  patch_diff: string | null
  patch_document_id: string | null
  metadata_log_id: string | null
  metadata_payload: string | null
  images: string | null
  files: string | null
  created_at: string
}

export interface ScheduledTask {
  id: string
  workspace_id: string
  name: string
  prompt: string
  cron_expression: string
  enabled: number
  /** Per-task provider override (e.g. 'anthropic'). NULL = use app default setting. */
  provider: string | null
  /** Per-task model id override (e.g. 'claude-opus-4-8'). NULL = use app default setting. */
  model: string | null
  last_run_at: string | null
  last_run_status: string | null
  next_run_at: string | null
  created_at: string
}

export interface ScheduledTaskRun {
  id: string
  task_id: string
  status: string
  result: string | null
  tokens_used: number | null
  error_message: string | null
  started_at: string
  finished_at: string | null
}
