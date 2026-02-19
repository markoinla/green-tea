export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  timestamp: number
  patchLogId?: string
  patchDiff?: string
  patchDocumentId?: string
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
  | { type: 'set_streaming'; streaming: boolean }
  | { type: 'remove_patch'; logId: string }
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
      const lastIdx = msgs.length - 1
      if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
        msgs[lastIdx] = {
          ...msgs[lastIdx],
          content: action.content,
          thinking: action.thinking ?? msgs[lastIdx].thinking
        }
      }
      return { ...state, messages: msgs }
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
    case 'update_tool_result': {
      const msgs = [...state.messages]
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].toolCallId === action.toolCallId) {
          msgs[i] = { ...msgs[i], toolResult: action.result, toolIsError: action.isError }
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
