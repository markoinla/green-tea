import { useState, useEffect, useCallback } from 'react'

interface GoogleAccountStatus {
  authenticated: boolean
  email?: string
  scopes: string[]
  enabledServices: string[]
}

export function useGoogleAccount() {
  const [status, setStatus] = useState<GoogleAccountStatus>({
    authenticated: false,
    scopes: [],
    enabledServices: []
  })
  const [loading, setLoading] = useState(true)
  const [connectingService, setConnectingService] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const s = await window.api.google.getStatus()
      setStatus(s)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const unsub = window.api.onGoogleChanged(fetchStatus)
    return unsub
  }, [fetchStatus])

  const connectService = useCallback(async (service: string) => {
    setConnectingService(service)
    try {
      const result = await window.api.google.connectService(service)
      return result
    } finally {
      setConnectingService(null)
    }
  }, [])

  const disconnectService = useCallback(async (service: string) => {
    await window.api.google.disconnectService(service)
  }, [])

  const clearAuth = useCallback(async () => {
    await window.api.google.clearAuth()
  }, [])

  return { status, loading, connectingService, connectService, disconnectService, clearAuth }
}
