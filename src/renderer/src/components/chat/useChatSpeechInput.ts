import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useSpeechToText } from '@renderer/hooks/useSpeechToText'

interface UseChatSpeechInputOptions {
  editor: Editor | null
}

interface UseChatSpeechInputResult {
  speechError: string | null
  speechStatus: 'idle' | 'connecting' | 'recording' | 'error'
  handleMicToggle: () => void
  stopSpeechIfActive: () => void
}

export function useChatSpeechInput({
  editor
}: UseChatSpeechInputOptions): UseChatSpeechInputResult {
  const [speechError, setSpeechError] = useState<string | null>(null)
  const preRecordingTextRef = useRef('')
  const speechErrorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const {
    status: speechStatus,
    toggle: toggleSpeech,
    stop: stopSpeech
  } = useSpeechToText({
    onTranscript: useCallback(
      (text: string) => {
        if (!editor) return
        const prefix = preRecordingTextRef.current
        const combined = prefix ? prefix + ' ' + text : text
        editor.commands.setContent(combined)
      },
      [editor]
    ),
    onError: useCallback((error: string) => {
      setSpeechError(error)
      clearTimeout(speechErrorTimerRef.current)
      speechErrorTimerRef.current = setTimeout(() => setSpeechError(null), 5000)
    }, [])
  })

  const handleMicToggle = useCallback(() => {
    if (speechStatus === 'idle' || speechStatus === 'error') {
      const text = editor?.getText() || ''
      preRecordingTextRef.current = text.trim()
    }

    setSpeechError(null)
    toggleSpeech()
  }, [speechStatus, editor, toggleSpeech])

  const stopSpeechIfActive = useCallback(() => {
    if (speechStatus === 'connecting' || speechStatus === 'recording') {
      stopSpeech()
    }
  }, [speechStatus, stopSpeech])

  useEffect(() => {
    return () => clearTimeout(speechErrorTimerRef.current)
  }, [])

  return {
    speechError,
    speechStatus,
    handleMicToggle,
    stopSpeechIfActive
  }
}
