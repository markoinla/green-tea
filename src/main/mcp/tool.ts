import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { getMcpManager } from './client-manager'

export function createMcpProxyTool(): ToolDefinition {
  return {
    name: 'mcp',
    label: 'MCP Tools',
    description:
      'Access external MCP (Model Context Protocol) tool servers. Modes: "status" shows configured servers, "search" finds tools by keyword, "list" shows all tools on a server, "describe" shows full tool details, "call" executes a tool.',
    parameters: Type.Object({
      mode: Type.Union([
        Type.Literal('status'),
        Type.Literal('search'),
        Type.Literal('list'),
        Type.Literal('describe'),
        Type.Literal('call')
      ]),
      query: Type.Optional(Type.String({ description: 'Search query (for search mode)' })),
      server: Type.Optional(Type.String({ description: 'Server name (for list mode)' })),
      tool: Type.Optional(Type.String({ description: 'Tool name (for describe/call mode)' })),
      arguments: Type.Optional(
        Type.Unknown({ description: 'Tool arguments as JSON object (for call mode)' })
      )
    }),
    async execute(_toolCallId, params) {
      const p = params as {
        mode: 'status' | 'search' | 'list' | 'describe' | 'call'
        query?: string
        server?: string
        tool?: string
        arguments?: unknown
      }
      const manager = getMcpManager()

      try {
        switch (p.mode) {
          case 'status': {
            const statuses = manager.getServerStatuses()
            if (statuses.length === 0) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'No MCP servers configured. Add servers in ~/Documents/Green Tea/mcp.json or Settings > MCP Servers.'
                  }
                ],
                details: undefined
              }
            }
            const lines = statuses.map(
              (s) =>
                `${s.name}: ${s.status}${s.error ? ` (${s.error})` : ''} — ${s.toolCount} tools`
            )
            return {
              content: [{ type: 'text' as const, text: lines.join('\n') }],
              details: undefined
            }
          }

          case 'search': {
            if (!p.query) {
              return {
                content: [
                  { type: 'text' as const, text: 'Error: query is required for search mode' }
                ],
                isError: true,
                details: undefined
              }
            }
            // Ensure tools are loaded from all connected servers
            await manager.listAllTools()
            const results = manager.searchTools(p.query)
            if (results.length === 0) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `No tools found matching "${p.query}". Try "status" to see available servers.`
                  }
                ],
                details: undefined
              }
            }
            const lines = results.map(
              (t) => `${t.name} (${t.serverName}): ${t.description || 'No description'}`
            )
            return {
              content: [{ type: 'text' as const, text: lines.join('\n') }],
              details: undefined
            }
          }

          case 'list': {
            if (!p.server) {
              return {
                content: [
                  { type: 'text' as const, text: 'Error: server is required for list mode' }
                ],
                isError: true,
                details: undefined
              }
            }
            const tools = await manager.listTools(p.server)
            if (tools.length === 0) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `No tools available on server "${p.server}".`
                  }
                ],
                details: undefined
              }
            }
            const lines = tools.map((t) => `${t.name}: ${t.description || 'No description'}`)
            return {
              content: [{ type: 'text' as const, text: lines.join('\n') }],
              details: undefined
            }
          }

          case 'describe': {
            if (!p.tool) {
              return {
                content: [
                  { type: 'text' as const, text: 'Error: tool is required for describe mode' }
                ],
                isError: true,
                details: undefined
              }
            }
            // Find the tool across all servers
            const allTools = await manager.listAllTools()
            const found = allTools.find((t) => t.name === p.tool)
            if (!found) {
              return {
                content: [
                  { type: 'text' as const, text: `Tool "${p.tool}" not found on any server.` }
                ],
                isError: true,
                details: undefined
              }
            }
            const desc = [
              `Tool: ${found.name}`,
              `Server: ${found.serverName}`,
              `Description: ${found.description || 'None'}`,
              `Input Schema:\n${JSON.stringify(found.inputSchema, null, 2)}`
            ].join('\n')
            return {
              content: [{ type: 'text' as const, text: desc }],
              details: undefined
            }
          }

          case 'call': {
            if (!p.tool) {
              return {
                content: [{ type: 'text' as const, text: 'Error: tool is required for call mode' }],
                isError: true,
                details: undefined
              }
            }
            const serverName = manager.findToolServer(p.tool!)
            if (!serverName) {
              // Try loading all tools first
              await manager.listAllTools()
              const retryServer = manager.findToolServer(p.tool!)
              if (!retryServer) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: `Tool "${p.tool}" not found on any server. Use search mode first.`
                    }
                  ],
                  isError: true,
                  details: undefined
                }
              }
              const result = await manager.callTool(
                retryServer,
                p.tool!,
                (p.arguments as Record<string, unknown>) || {}
              )
              return { ...result, details: undefined }
            }
            const result = await manager.callTool(
              serverName,
              p.tool!,
              (p.arguments as Record<string, unknown>) || {}
            )
            return { ...result, details: undefined }
          }

          default:
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: Invalid mode. Use status, search, list, describe, or call.'
                }
              ],
              isError: true,
              details: undefined
            }
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true,
          details: undefined
        }
      }
    }
  }
}
