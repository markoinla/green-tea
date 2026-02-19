import { useState, useEffect, useCallback } from 'react'

interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  transport?: 'stdio' | 'http'
  url?: string
  lifecycle?: 'lazy' | 'eager'
  idleTimeout?: number
  enabled?: boolean
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
}

interface McpServerStatus {
  name: string
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  toolCount: number
  authStatus: 'none' | 'authenticated' | 'unauthenticated'
}

export function useMcpServers() {
  const [config, setConfig] = useState<McpConfig>({ mcpServers: {} })
  const [statuses, setStatuses] = useState<McpServerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [cfg, sts] = await Promise.all([
        window.api.mcp.getConfig() as Promise<McpConfig>,
        window.api.mcp.getStatuses() as Promise<McpServerStatus[]>
      ])
      setConfig(cfg)
      setStatuses(sts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const unsub = window.api.onMcpChanged(fetchData)
    return unsub
  }, [fetchData])

  const addServer = useCallback(
    async (name: string, serverConfig: McpServerConfig) => {
      setError(null)
      try {
        const newConfig = {
          mcpServers: { ...config.mcpServers, [name]: serverConfig }
        }
        await window.api.mcp.saveConfig(newConfig)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [config]
  )

  const removeServer = useCallback(
    async (name: string) => {
      setError(null)
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [name]: _, ...rest } = config.mcpServers
        await window.api.mcp.saveConfig({ mcpServers: rest })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [config]
  )

  const updateServer = useCallback(
    async (name: string, serverConfig: McpServerConfig) => {
      setError(null)
      try {
        const newConfig = {
          mcpServers: { ...config.mcpServers, [name]: serverConfig }
        }
        await window.api.mcp.saveConfig(newConfig)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [config]
  )

  const testConnection = useCallback(async (name: string) => {
    setTesting(name)
    setError(null)
    try {
      const result = await window.api.mcp.testConnection(name)
      if (!result.success) {
        setError(result.error || 'Connection failed')
      }
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      setTesting(null)
    }
  }, [])

  const refreshStatuses = useCallback(async () => {
    try {
      const sts = (await window.api.mcp.getStatuses()) as McpServerStatus[]
      setStatuses(sts)
    } catch {
      // ignore
    }
  }, [])

  const [authenticating, setAuthenticating] = useState<string | null>(null)

  const authenticate = useCallback(async (name: string) => {
    console.log('[MCP] authenticate called for:', name)
    setAuthenticating(name)
    setError(null)
    try {
      const result = await window.api.mcp.authenticate(name)
      console.log('[MCP] authenticate result:', result)
      if (!result.success) {
        setError(result.error || 'Authentication failed')
      }
      return result
    } catch (err) {
      console.error('[MCP] authenticate error:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      return { success: false, error: msg }
    } finally {
      setAuthenticating(null)
    }
  }, [])

  const clearAuth = useCallback(async (name: string) => {
    setError(null)
    try {
      await window.api.mcp.clearAuth(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  return {
    config,
    statuses,
    loading,
    testing,
    error,
    authenticating,
    addServer,
    removeServer,
    updateServer,
    testConnection,
    refreshStatuses,
    authenticate,
    clearAuth
  }
}
