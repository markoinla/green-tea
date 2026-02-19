import { useState, useCallback, type Dispatch, type SetStateAction } from 'react'
import { chatReducer, type ChatAction, type ChatState, type Message } from './chat-types'

const EMPTY_STATE: ChatState = { messages: [], isStreaming: false }

export function useChatState(): {
  chatStates: Map<string, ChatState>
  setChatStates: Dispatch<SetStateAction<Map<string, ChatState>>>
  dispatchTo: (conversationId: string, action: ChatAction) => void
  getState: (conversationId: string | null) => ChatState
} {
  const [chatStates, setChatStates] = useState<Map<string, ChatState>>(new Map())

  const dispatchTo = useCallback((conversationId: string, action: ChatAction) => {
    setChatStates((prev) => {
      const current = prev.get(conversationId) || { messages: [], isStreaming: false }
      const next = chatReducer(current, action)
      const newMap = new Map(prev)
      newMap.set(conversationId, next)
      return newMap
    })
  }, [])

  const getState = useCallback(
    (conversationId: string | null): ChatState => {
      if (!conversationId) return { messages: [] as Message[], isStreaming: false }
      return chatStates.get(conversationId) || EMPTY_STATE
    },
    [chatStates]
  )

  return { chatStates, setChatStates, dispatchTo, getState }
}
