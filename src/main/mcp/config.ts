import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { getDatabase } from '../database/connection'
import { getSettingsDir } from '../agent/paths'

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  transport?: 'stdio' | 'http'
  url?: string
  lifecycle?: 'lazy' | 'eager'
  idleTimeout?: number
  enabled?: boolean
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
}

/**
 * Path to the global MCP config, now consolidated under the hidden `.settings/`
 * folder (§4.2). Resolves via `getSettingsDir(getDatabase())` so it respects the
 * `agentBaseDir` override (the old hardcoded-homedir path ignored it). Reads the
 * DB singleton internally to keep the public signature unchanged for callers.
 */
export function getMcpConfigPath(): string {
  return join(getSettingsDir(getDatabase()), 'mcp.json')
}

const DEFAULT_CONFIG: McpConfig = {
  mcpServers: {
    'granola-mcp': {
      transport: 'http',
      url: 'https://mcp.granola.ai/mcp',
      enabled: false
    },
    'chrome-dev-tools': {
      command: 'npx',
      transport: 'stdio',
      args: ['chrome-devtools-mcp@latest'],
      enabled: false
    }
  }
}

export function loadMcpConfig(): McpConfig {
  const configPath = getMcpConfigPath()
  if (!existsSync(configPath)) {
    saveMcpConfig(DEFAULT_CONFIG)
    return DEFAULT_CONFIG
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (e) {
    console.error(`Warning: Could not parse ${configPath}: ${e}`)
    saveMcpConfig(DEFAULT_CONFIG)
    return DEFAULT_CONFIG
  }
}

export function saveMcpConfig(config: McpConfig): void {
  const configPath = getMcpConfigPath()
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2))
}
