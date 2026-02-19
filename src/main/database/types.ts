export interface Document {
  id: string
  title: string
  content: string | null
  workspace_id: string
  folder_id: string | null
  created_at: string
  updated_at: string
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
  last_run_at: string | null
  last_run_status: string | null
  next_run_at: string | null
  created_at: string
}

export interface DocumentVersion {
  id: string
  document_id: string
  title: string
  content: string | null
  source: string // 'autosave' | 'agent_patch' | 'manual' | 'restore'
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
