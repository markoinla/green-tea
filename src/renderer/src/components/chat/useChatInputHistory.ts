import { useCallback, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { HISTORY_KEY } from './chat-input-constants'

interface HistoryKeyDownArgs {
  event: KeyboardEvent
  editor: Editor
  getPlainText: () => string
}

interface UseChatInputHistoryResult {
  pushHistory: (text: string) => void
  resetHistoryCursor: () => void
  handleHistoryKeyDown: (args: HistoryKeyDownArgs) => boolean
}

export function useChatInputHistory(): UseChatInputHistoryResult {
  const historyIndexRef = useRef(-1)
  const draftRef = useRef('')

  const getHistory = useCallback((): string[] => {
    try {
      return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]')
    } catch {
      return []
    }
  }, [])

  const pushHistory = useCallback(
    (text: string) => {
      const history = getHistory()
      if (history[history.length - 1] === text) return
      history.push(text)
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history))
    },
    [getHistory]
  )

  const resetHistoryCursor = useCallback(() => {
    historyIndexRef.current = -1
    draftRef.current = ''
  }, [])

  const handleHistoryKeyDown = useCallback(
    ({ event, editor, getPlainText }: HistoryKeyDownArgs): boolean => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false

      const history = getHistory()
      if (history.length === 0) return false

      const isUp = event.key === 'ArrowUp'

      if (isUp && historyIndexRef.current === -1) {
        const { from, to } = editor.state.selection
        if (from !== to || from !== 0) {
          if (!editor.isEmpty) return false
        }
      }

      event.preventDefault()

      if (isUp) {
        if (historyIndexRef.current === -1) {
          draftRef.current = getPlainText()
          historyIndexRef.current = history.length - 1
        } else if (historyIndexRef.current > 0) {
          historyIndexRef.current--
        }

        editor.commands.setContent(history[historyIndexRef.current])
        editor.commands.focus('end')
        return true
      }

      if (historyIndexRef.current === -1) return false

      if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current++
        editor.commands.setContent(history[historyIndexRef.current])
        editor.commands.focus('end')
        return true
      }

      historyIndexRef.current = -1
      if (draftRef.current) {
        editor.commands.setContent(draftRef.current)
        editor.commands.focus('end')
      } else {
        editor.commands.clearContent()
      }
      return true
    },
    [getHistory]
  )

  return {
    pushHistory,
    resetHistoryCursor,
    handleHistoryKeyDown
  }
}
