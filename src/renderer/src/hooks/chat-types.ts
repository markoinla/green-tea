/** One note's metadata changes inside a batched proposal (renderer mirror). */
export interface MetadataEditItem {
  document_id: string
  changedKeys: Record<string, unknown>
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  timestamp: number
  patchLogId?: string
  patchDiff?: string
  patchDocumentId?: string
  metadataLogId?: string
  metadataPayload?: MetadataEditItem[]
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolCallId?: string
  toolResult?: string
  toolIsError?: boolean
  images?: { data: string; mimeType: string }[]
  files?: { name: string }[]
}

export type ChatAction =
  | { type: 'add_message'; message: Message }
  | { type: 'set_last_assistant_content'; content: string; thinking?: string }
  | {
      type: 'upsert_tool_call'
      id: string
      timestamp: number
      toolCallId: string
      toolName: string
      toolArgs?: Record<string, unknown>
    }
  | { type: 'set_streaming'; streaming: boolean }
  | { type: 'remove_patch'; logId: string }
  | { type: 'remove_metadata'; logId: string }
  | { type: 'update_tool_result'; toolCallId: string; result?: string; isError?: boolean }
  | { type: 'set_tokens'; tokens: { input: number; output: number; total: number } }
  | { type: 'clear' }

export interface ChatState {
  messages: Message[]
  isStreaming: boolean
  tokens?: { input: number; output: number; total: number }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'add_message':
      return { ...state, messages: [...state.messages, action.message] }
    case 'set_last_assistant_content': {
      const msgs = [...state.messages]
      // Target the most recent assistant *text* bubble, skipping tool-call cards
      // that may have been appended after it once tool calls started streaming.
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant' && !msgs[i].toolName) {
          msgs[i] = {
            ...msgs[i],
            content: action.content,
            thinking: action.thinking ?? msgs[i].thinking
          }
          break
        }
      }
      return { ...state, messages: msgs }
    }
    case 'upsert_tool_call': {
      const msgs = [...state.messages]
      const idx = msgs.findIndex((m) => m.toolCallId === action.toolCallId)
      if (idx >= 0) {
        // Existing card (from streaming or a prior upsert) — refresh name/args as they fill in
        msgs[idx] = {
          ...msgs[idx],
          toolName: action.toolName,
          toolArgs: action.toolArgs ?? msgs[idx].toolArgs
        }
        return { ...state, messages: msgs }
      }
      return {
        ...state,
        messages: [
          ...msgs,
          {
            id: action.id,
            role: 'assistant',
            content: '',
            timestamp: action.timestamp,
            toolName: action.toolName,
            toolArgs: action.toolArgs,
            toolCallId: action.toolCallId
          }
        ]
      }
    }
    case 'set_streaming':
      return { ...state, isStreaming: action.streaming }
    case 'remove_patch': {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.patchLogId === action.logId ? { ...m, patchLogId: undefined, patchDiff: undefined } : m
        )
      }
    }
    case 'remove_metadata': {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.metadataLogId === action.logId
            ? { ...m, metadataLogId: undefined, metadataPayload: undefined }
            : m
        )
      }
    }
    case 'update_tool_result': {
      const msgs = [...state.messages]
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].toolCallId === action.toolCallId) {
          // A result has arrived, so the tool is no longer pending. Default a
          // missing/undefined isError to false so the pending spinner clears.
          msgs[i] = { ...msgs[i], toolResult: action.result, toolIsError: action.isError ?? false }
          break
        }
      }
      return { ...state, messages: msgs }
    }
    case 'set_tokens':
      return { ...state, tokens: action.tokens }
    case 'clear':
      return { messages: [], isStreaming: false, tokens: undefined }
    default:
      return state
  }
}

export type DisplayItem =
  | { type: 'message'; message: Message }
  | { type: 'activity-group'; id: string; tools: Message[]; thinking?: string }

export function groupMessages(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = []
  let toolBuffer: Message[] = []
  let thinkingParts: string[] = []

  function flushGroup(followingMsg?: Message) {
    if (toolBuffer.length === 0 && thinkingParts.length === 0) return

    if (followingMsg?.role === 'assistant' && followingMsg.thinking) {
      thinkingParts.push(followingMsg.thinking)
    }

    items.push({
      type: 'activity-group',
      id: `group-${toolBuffer[0]?.id ?? crypto.randomUUID()}`,
      tools: [...toolBuffer],
      thinking: thinkingParts.length > 0 ? thinkingParts.join('\n\n') : undefined
    })
    toolBuffer = []
    thinkingParts = []
  }

  for (const msg of messages) {
    // Skip empty assistant placeholders (from message_start before content arrives)
    if (msg.role === 'assistant' && !msg.toolName && !msg.content.trim() && !msg.thinking) {
      continue
    }

    if (msg.toolName) {
      // First tool after an assistant message — pull thinking into the group
      if (toolBuffer.length === 0) {
        const prev = items[items.length - 1]
        if (
          prev?.type === 'message' &&
          prev.message.role === 'assistant' &&
          prev.message.thinking
        ) {
          thinkingParts.push(prev.message.thinking)
          items[items.length - 1] = {
            type: 'message',
            message: { ...prev.message, thinking: undefined }
          }
        }
      }
      toolBuffer.push(msg)
    } else if (msg.role === 'assistant' && !msg.content.trim()) {
      // Assistant with no visible content (intermediate message between tools)
      // Fold into current activity group instead of breaking the tool sequence
      if (msg.thinking) thinkingParts.push(msg.thinking)
    } else {
      const stripThinking =
        (toolBuffer.length > 0 || thinkingParts.length > 0) &&
        msg.role === 'assistant' &&
        !!msg.thinking
      flushGroup(stripThinking ? msg : undefined)
      items.push({
        type: 'message',
        message: stripThinking ? { ...msg, thinking: undefined } : msg
      })
    }
  }
  flushGroup()

  return items
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}
