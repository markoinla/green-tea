import { useState, useEffect, useCallback } from 'react'

export type LlmAccountStatus = Record<string, { connected: boolean }>

/**
 * Connection state for LLM subscription accounts (Claude Pro/Max, ChatGPT
 * Codex) that back the agent. Connecting opens the system browser; the hook
 * refreshes when the main process broadcasts `llm-auth:changed`.
 */
export function useLlmAccounts() {
  const [status, setStatus] = useState<LlmAccountStatus>({})
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const s = await window.api.llmAuth.getStatus()
      setStatus(s)
    } catch {
      // best-effort; leave prior state on failure
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const unsub = window.api.onLlmAuthChanged(fetchStatus)
    return unsub
  }, [fetchStatus])

  const connect = useCallback(async (providerId: string) => {
    setConnecting(providerId)
    try {
      return await window.api.llmAuth.connect(providerId)
    } finally {
      setConnecting(null)
    }
  }, [])

  const disconnect = useCallback(async (providerId: string) => {
    await window.api.llmAuth.disconnect(providerId)
  }, [])

  const isConnected = useCallback(
    (providerId: string) => status[providerId]?.connected ?? false,
    [status]
  )

  return { status, loading, connecting, connect, disconnect, isConnected }
}
