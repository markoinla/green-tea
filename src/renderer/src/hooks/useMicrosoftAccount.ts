import { useState, useEffect, useCallback } from 'react'

interface MicrosoftAccountStatus {
  authenticated: boolean
  email?: string
  displayName?: string
  scopes: string[]
  enabledServices: string[]
}

export function useMicrosoftAccount() {
  const [status, setStatus] = useState<MicrosoftAccountStatus>({
    authenticated: false,
    scopes: [],
    enabledServices: []
  })
  const [loading, setLoading] = useState(true)
  const [connectingService, setConnectingService] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const s = await window.api.microsoft.getStatus()
      setStatus(s)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const unsub = window.api.onMicrosoftChanged(fetchStatus)
    return unsub
  }, [fetchStatus])

  const connectService = useCallback(async (service: string) => {
    setConnectingService(service)
    try {
      const result = await window.api.microsoft.connectService(service)
      return result
    } finally {
      setConnectingService(null)
    }
  }, [])

  const disconnectService = useCallback(async (service: string) => {
    await window.api.microsoft.disconnectService(service)
  }, [])

  const clearAuth = useCallback(async () => {
    await window.api.microsoft.clearAuth()
  }, [])

  return { status, loading, connectingService, connectService, disconnectService, clearAuth }
}
