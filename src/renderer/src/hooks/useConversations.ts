import { useState, useEffect, useCallback } from 'react'
import type { Conversation, ConversationMessage } from '../../../main/database/types'
import type { Message } from './chat-types'

export function dbMessageToChatMessage(m: ConversationMessage): Message {
  return {
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    thinking: m.thinking ?? undefined,
    timestamp: new Date(m.created_at).getTime(),
    patchLogId: m.patch_log_id ?? undefined,
    patchDiff: m.patch_diff ?? undefined,
    patchDocumentId: m.patch_document_id ?? undefined,
    toolName: m.tool_name ?? undefined,
    toolArgs: m.tool_args ? JSON.parse(m.tool_args) : undefined,
    toolCallId: m.tool_call_id ?? undefined,
    toolResult: m.tool_result ?? undefined,
    toolIsError: m.tool_is_error ? true : undefined,
    images: m.images ? JSON.parse(m.images) : undefined,
    files: m.files ? JSON.parse(m.files) : undefined
  }
}

interface UseConversationsResult {
  conversations: Conversation[]
  loading: boolean
  createConversation: () => Promise<Conversation | null>
  deleteConversation: (id: string) => Promise<void>
  canCreateNew: boolean
  refresh: () => Promise<void>
}

export function useConversations(workspaceId: string | null): UseConversationsResult {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setConversations([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const list = await window.api.conversations.list(workspaceId)
      setConversations(list)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    refresh()
    const unsub = window.api.onConversationsChanged(() => {
      refresh()
    })
    return unsub
  }, [refresh])

  const createConversation = useCallback(async () => {
    if (!workspaceId || conversations.length >= 3) return null
    const conv = await window.api.conversations.create({ workspace_id: workspaceId })
    await refresh()
    return conv
  }, [workspaceId, conversations.length, refresh])

  const deleteConversation = useCallback(
    async (id: string) => {
      await window.api.conversations.delete(id)
      await refresh()
    },
    [refresh]
  )

  return {
    conversations,
    loading,
    createConversation,
    deleteConversation,
    canCreateNew: conversations.length < 3,
    refresh
  }
}

interface UseConversationMessagesResult {
  messages: Message[]
  loading: boolean
  refresh: () => Promise<void>
}

export function useConversationMessages(
  conversationId: string | null
): UseConversationMessagesResult {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setMessages([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const dbMessages = await window.api.conversations.listMessages(conversationId)
      setMessages(dbMessages.map(dbMessageToChatMessage))
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { messages, loading, refresh }
}
