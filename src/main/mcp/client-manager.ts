import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { loadMcpConfig } from './config'
import type { McpServerConfig } from './config'
import {
  createElectronOAuthProvider,
  startOAuthCallbackServer,
  hasAuthData,
  OAUTH_REDIRECT_URL
} from './oauth'

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema: unknown
  serverName: string
}

export interface McpServerStatus {
  name: string
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  toolCount: number
  authStatus: 'none' | 'authenticated' | 'unauthenticated'
}

interface ManagedServer {
  config: McpServerConfig
  client: Client | null
  transport: StdioClientTransport | StreamableHTTPClientTransport | null
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  toolsCache: McpToolInfo[]
  toolsCacheTime: number
  idleTimer: ReturnType<typeof setTimeout> | null
}

const TOOLS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const DEFAULT_IDLE_TIMEOUT = 600 // seconds
const OPERATION_TIMEOUT = 30000 // ms

class McpClientManager {
  private servers = new Map<string, ManagedServer>()

  loadConfig(): void {
    const config = loadMcpConfig()
    const configuredNames = new Set(Object.keys(config.mcpServers))

    // Disconnect removed servers
    for (const [name] of this.servers) {
      if (!configuredNames.has(name)) {
        this.disconnect(name)
        this.servers.delete(name)
      }
    }

    // Add/update server entries
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      const existing = this.servers.get(name)
      if (existing) {
        existing.config = serverConfig
      } else {
        this.servers.set(name, {
          config: serverConfig,
          client: null,
          transport: null,
          status: 'disconnected',
          toolsCache: [],
          toolsCacheTime: 0,
          idleTimer: null
        })
      }
    }
  }

  async connect(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server) throw new Error(`MCP server not found: ${name}`)
    if (server.config.enabled === false) throw new Error(`MCP server disabled: ${name}`)
    if (server.status === 'connected' && server.client) return

    server.status = 'connecting'
    server.error = undefined

    try {
      const client = new Client({ name: `greentea-${name}`, version: '1.0.0' })

      let transport: StdioClientTransport | StreamableHTTPClientTransport
      if (server.config.transport === 'http' && server.config.url) {
        const authProvider = createElectronOAuthProvider(name, OAUTH_REDIRECT_URL)
        transport = new StreamableHTTPClientTransport(new URL(server.config.url), {
          authProvider
        })
      } else {
        if (!server.config.command)
          throw new Error(`MCP server "${name}" has no command configured`)
        const parts = server.config.command.trim().split(/\s+/)
        const command = parts[0]
        const extraArgs = parts.slice(1)
        const args = [...extraArgs, ...(server.config.args || [])]
        transport = new StdioClientTransport({
          command,
          args: args.length > 0 ? args : undefined,
          env: { ...process.env, ...(server.config.env || {}) } as Record<string, string>
        })
      }

      transport.onclose = () => {
        server.status = 'disconnected'
        server.client = null
        server.transport = null
      }
      transport.onerror = (err) => {
        server.status = 'error'
        server.error = err instanceof Error ? err.message : String(err)
      }

      await client.connect(transport)

      server.client = client
      server.transport = transport
      server.status = 'connected'

      // Cache tools
      await this.refreshTools(name)

      // Start idle timer
      this.resetIdleTimer(name)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        server.status = 'error'
        server.error = 'Authentication required'
      } else {
        server.status = 'error'
        server.error = err instanceof Error ? err.message : String(err)
      }
      server.client = null
      server.transport = null
      throw err
    }
  }

  disconnect(name: string): void {
    const server = this.servers.get(name)
    if (!server) return

    if (server.idleTimer) {
      clearTimeout(server.idleTimer)
      server.idleTimer = null
    }

    if (server.client) {
      try {
        server.client.close()
      } catch {
        // Ignore close errors
      }
    }
    if (server.transport) {
      try {
        server.transport.close()
      } catch {
        // Ignore close errors
      }
    }

    server.client = null
    server.transport = null
    server.status = 'disconnected'
    server.error = undefined
  }

  disconnectAll(): void {
    for (const [name] of this.servers) {
      this.disconnect(name)
    }
  }

  async ensureConnected(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server) throw new Error(`MCP server not found: ${name}`)
    if (server.status !== 'connected' || !server.client) {
      await this.connect(name)
    }
    this.resetIdleTimer(name)
  }

  private resetIdleTimer(name: string): void {
    const server = this.servers.get(name)
    if (!server) return
    if (server.idleTimer) clearTimeout(server.idleTimer)
    const timeout = (server.config.idleTimeout ?? DEFAULT_IDLE_TIMEOUT) * 1000
    server.idleTimer = setTimeout(() => {
      console.log(`MCP server "${name}" idle timeout — disconnecting`)
      this.disconnect(name)
    }, timeout)
  }

  private async refreshTools(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server?.client) return

    const result = await server.client.listTools({
      _meta: { signal: AbortSignal.timeout(OPERATION_TIMEOUT) }
    })
    server.toolsCache = (result.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      serverName: name
    }))
    server.toolsCacheTime = Date.now()
  }

  async listTools(name: string): Promise<McpToolInfo[]> {
    const server = this.servers.get(name)
    if (!server) throw new Error(`MCP server not found: ${name}`)

    await this.ensureConnected(name)

    if (Date.now() - server.toolsCacheTime > TOOLS_CACHE_TTL) {
      await this.refreshTools(name)
    }

    return server.toolsCache
  }

  async listAllTools(): Promise<McpToolInfo[]> {
    const all: McpToolInfo[] = []
    for (const [name, server] of this.servers) {
      if (server.config.enabled === false) continue
      try {
        const tools = await this.listTools(name)
        all.push(...tools)
      } catch {
        // Skip servers that fail to connect
      }
    }
    return all
  }

  searchTools(query: string): McpToolInfo[] {
    const q = query.toLowerCase()
    const scored: { tool: McpToolInfo; score: number }[] = []

    for (const [, server] of this.servers) {
      if (server.config.enabled === false) continue
      for (const tool of server.toolsCache) {
        let score = 0
        const nameLower = tool.name.toLowerCase()
        const descLower = (tool.description || '').toLowerCase()

        if (nameLower === q) score += 10
        else if (nameLower.includes(q)) score += 5

        // Word boundary match
        const words = q.split(/\s+/)
        for (const word of words) {
          if (nameLower.includes(word)) score += 2
          if (descLower.includes(word)) score += 1
        }

        if (score > 0) {
          scored.push({ tool, score })
        }
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 10).map((s) => s.tool)
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{
    content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
    isError?: boolean
  }> {
    await this.ensureConnected(serverName)
    const server = this.servers.get(serverName)
    if (!server?.client) throw new Error(`MCP server not connected: ${serverName}`)

    const result = await server.client.callTool({ name: toolName, arguments: args }, undefined, {
      signal: AbortSignal.timeout(OPERATION_TIMEOUT)
    })

    // Format result content
    const content: (
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string }
    )[] = []
    if (Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type === 'text') {
          content.push({ type: 'text', text: String(item.text) })
        } else if (item.type === 'image') {
          content.push({
            type: 'image',
            data: String(item.data),
            mimeType: String(item.mimeType)
          })
        } else {
          content.push({ type: 'text', text: JSON.stringify(item) })
        }
      }
    }
    if (content.length === 0) {
      content.push({ type: 'text', text: 'Tool returned no content' })
    }
    return { content, isError: result.isError === true ? true : undefined }
  }

  getServerStatuses(): McpServerStatus[] {
    const statuses: McpServerStatus[] = []
    for (const [name, server] of this.servers) {
      let authStatus: 'none' | 'authenticated' | 'unauthenticated' = 'none'
      if (server.config.transport === 'http') {
        authStatus = hasAuthData(name) ? 'authenticated' : 'unauthenticated'
      }
      statuses.push({
        name,
        status: server.status,
        error: server.error,
        toolCount: server.toolsCache.length,
        authStatus
      })
    }
    return statuses
  }

  findToolServer(toolName: string): string | undefined {
    for (const [name, server] of this.servers) {
      if (server.config.enabled === false) continue
      if (server.toolsCache.some((t) => t.name === toolName)) {
        return name
      }
    }
    return undefined
  }

  async authenticate(name: string): Promise<{ success: boolean; error?: string }> {
    const server = this.servers.get(name)
    if (!server) return { success: false, error: `MCP server not found: ${name}` }
    if (server.config.transport !== 'http' || !server.config.url) {
      return { success: false, error: 'Only HTTP servers support OAuth authentication' }
    }

    let callbackServer: Awaited<ReturnType<typeof startOAuthCallbackServer>> | null = null
    try {
      console.log(`[MCP OAuth] Starting authentication for "${name}"`)
      callbackServer = await startOAuthCallbackServer()
      console.log(`[MCP OAuth] Callback server listening on port ${callbackServer.port}`)
      const authProvider = createElectronOAuthProvider(name, OAUTH_REDIRECT_URL)

      const transport = new StreamableHTTPClientTransport(new URL(server.config.url), {
        authProvider
      })
      const client = new Client({ name: `greentea-${name}-auth`, version: '1.0.0' })

      try {
        await client.connect(transport)
        // Connected without needing auth — tokens were already valid
        console.log(`[MCP OAuth] Connected without needing auth for "${name}"`)
        try {
          client.close()
        } catch {
          /* ignore */
        }
        try {
          transport.close()
        } catch {
          /* ignore */
        }
        callbackServer.close()
        return { success: true }
      } catch (err) {
        if (!(err instanceof UnauthorizedError)) {
          console.error(`[MCP OAuth] Non-auth error for "${name}":`, err)
          try {
            transport.close()
          } catch {
            /* ignore */
          }
          callbackServer.close()
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }

        // UnauthorizedError means the browser was opened for auth
        console.log(`[MCP OAuth] Waiting for authorization code from browser for "${name}"`)
        const code = await callbackServer.waitForCode()
        console.log(`[MCP OAuth] Received authorization code for "${name}"`)
        await transport.finishAuth(code)
        callbackServer.close()

        try {
          client.close()
        } catch {
          /* ignore */
        }
        try {
          transport.close()
        } catch {
          /* ignore */
        }

        return { success: true }
      }
    } catch (err) {
      callbackServer?.close()
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

let instance: McpClientManager | null = null

export function getMcpManager(): McpClientManager {
  if (!instance) {
    instance = new McpClientManager()
  }
  return instance
}
