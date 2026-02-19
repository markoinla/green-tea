import { useCallback, useEffect, useRef, useState } from 'react'

const PROXY_WS_URL = 'wss://greentea-proxy.m-6bb.workers.dev/v1/listen'

interface UseSpeechToTextOptions {
  onTranscript: (text: string, isFinal: boolean) => void
  onError?: (error: string) => void
  language?: string
  model?: string
}

interface UseSpeechToTextReturn {
  status: 'idle' | 'connecting' | 'recording' | 'error'
  toggle: () => void
  stop: () => void
}

export function useSpeechToText({
  onTranscript,
  onError,
  language = 'en',
  model = 'nova-3'
}: UseSpeechToTextOptions): UseSpeechToTextReturn {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'recording' | 'error'>('idle')

  const wsRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const finalsRef = useRef<string[]>([])

  // Keep callbacks in refs to avoid stale closures
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onErrorRef.current = onError
  }, [onTranscript, onError])

  const cleanup = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    recorderRef.current = null

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        // Send empty buffer as Deepgram flush signal
        wsRef.current.send(new Uint8Array(0))
        wsRef.current.close()
      }
      wsRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    finalsRef.current = []
  }, [])

  const start = useCallback(async () => {
    setStatus('connecting')
    finalsRef.current = []

    // 1. Get microphone access
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true
        }
      })
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : 'Could not access microphone'
      setStatus('error')
      onErrorRef.current?.(msg)
      return
    }
    streamRef.current = stream

    // 2. Open WebSocket to proxy
    const params = new URLSearchParams({
      model,
      language,
      punctuate: 'true',
      interim_results: 'true',
      smart_format: 'true'
    })

    const ws = new WebSocket(`${PROXY_WS_URL}?${params}`)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      console.log('[stt] ws open')
      setStatus('recording')

      // 3. Start MediaRecorder
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      })
      recorderRef.current = recorder

      recorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          console.log('[stt] sending audio chunk:', e.data.size, 'bytes')
          ws.send(e.data)
        }
      })

      recorder.start(250) // timeslice: send data every 250ms
    })

    ws.addEventListener('message', (event) => {
      console.log('[stt] ws message:', event.data)
      try {
        const data = JSON.parse(event.data as string)
        const transcript = data?.channel?.alternatives?.[0]?.transcript
        console.log('[stt] transcript:', JSON.stringify(transcript), 'is_final:', data.is_final)
        if (typeof transcript !== 'string' || transcript === '') return

        const isFinal = !!data.is_final
        if (isFinal) {
          finalsRef.current.push(transcript)
          onTranscriptRef.current(finalsRef.current.join(' '), true)
        } else {
          const combined = [...finalsRef.current, transcript].join(' ')
          onTranscriptRef.current(combined, false)
        }
      } catch (err) {
        console.log('[stt] parse error:', err)
      }
    })

    ws.addEventListener('error', (e) => {
      console.log('[stt] ws error:', e)
      cleanup()
      setStatus('error')
      onErrorRef.current?.('Speech-to-text connection failed')
    })

    ws.addEventListener('close', (e) => {
      console.log('[stt] ws close:', e.code, e.reason)
      // Only transition to idle if we were recording (not already error)
      setStatus((prev) => (prev === 'error' ? prev : 'idle'))
      cleanup()
    })
  }, [model, language, cleanup])

  const stop = useCallback(() => {
    cleanup()
    setStatus('idle')
  }, [cleanup])

  const toggle = useCallback(() => {
    if (status === 'connecting' || status === 'recording') {
      stop()
    } else {
      start()
    }
  }, [status, start, stop])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return { status, toggle, stop }
}
