import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'

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

export function getMcpConfigPath(): string {
  return join(homedir(), 'Documents', 'Green Tea', 'mcp.json')
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
