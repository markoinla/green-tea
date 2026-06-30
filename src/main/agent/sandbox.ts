/**
 * Sandbox module — OS-level sandboxing for agent bash commands.
 *
 * Uses @anthropic-ai/sandbox-runtime to enforce filesystem and network
 * restrictions (sandbox-exec on macOS, bubblewrap on Linux).
 *
 * Config files (merged, project-local takes precedence):
 * - ~/.greentea/sandbox.json (global)
 *
 * Example sandbox.json:
 * ```json
 * {
 *   "enabled": true,
 *   "network": {
 *     "allowedDomains": ["github.com", "*.github.com"],
 *     "deniedDomains": []
 *   },
 *   "filesystem": {
 *     "denyRead": ["~/.ssh", "~/.aws"],
 *     "allowWrite": [".", "/tmp"],
 *     "denyWrite": [".env"]
 *   }
 * }
 * ```
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SandboxManager, type SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import { rgPath as bundledRgPath } from '@vscode/ripgrep'
import type { BashOperations } from '@earendil-works/pi-coding-agent'

function resolveRgPath(): string {
  // Prefer bundled ripgrep if available
  if (existsSync(bundledRgPath)) return bundledRgPath
  // Common system locations for ripgrep
  const candidates = ['/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg']
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return bundledRgPath
}

interface SandboxConfig extends SandboxRuntimeConfig {
  enabled?: boolean
  // Set when the global sandbox.json requests allow-all network via
  // allowedDomains: ["*"]. The runtime can't express a broad wildcard in its
  // allowlist (it rejects "*"), so instead we keep the network proxy running
  // and auto-approve every host via the ask-callback. Filesystem restrictions
  // are independent of network and remain fully enforced.
  allowAllNetwork?: boolean
}

function defaultConfig(agentBaseDir: string): SandboxConfig {
  return {
    enabled: true,
    network: {
      allowedDomains: [
        'npmjs.org',
        '*.npmjs.org',
        'registry.npmjs.org',
        'registry.yarnpkg.com',
        'pypi.org',
        '*.pypi.org',
        'github.com',
        '*.github.com',
        'api.github.com',
        'raw.githubusercontent.com'
      ],
      deniedDomains: []
    },
    filesystem: {
      denyRead: ['~/.ssh', '~/.aws', '~/.gnupg'],
      allowWrite: [agentBaseDir],
      denyWrite: ['.env', '.env.*', '*.pem', '*.key']
    }
  }
}

function deepMerge(base: SandboxConfig, overrides: Partial<SandboxConfig>): SandboxConfig {
  const result: SandboxConfig = { ...base }

  if (overrides.enabled !== undefined) result.enabled = overrides.enabled
  if (overrides.network) {
    result.network = { ...base.network, ...overrides.network }
  }
  if (overrides.filesystem) {
    result.filesystem = { ...base.filesystem, ...overrides.filesystem }
  }

  const extOverrides = overrides as {
    ignoreViolations?: Record<string, string[]>
    enableWeakerNestedSandbox?: boolean
  }
  const extResult = result as {
    ignoreViolations?: Record<string, string[]>
    enableWeakerNestedSandbox?: boolean
  }

  if (extOverrides.ignoreViolations) {
    extResult.ignoreViolations = extOverrides.ignoreViolations
  }
  if (extOverrides.enableWeakerNestedSandbox !== undefined) {
    extResult.enableWeakerNestedSandbox = extOverrides.enableWeakerNestedSandbox
  }

  return result
}

export function loadSandboxConfig(
  agentBaseDir: string,
  extraWritePaths: string[] = []
): SandboxConfig {
  const globalConfigPath = join(homedir(), '.greentea', 'sandbox.json')

  let globalConfig: Partial<SandboxConfig> = {}

  if (existsSync(globalConfigPath)) {
    try {
      globalConfig = JSON.parse(readFileSync(globalConfigPath, 'utf-8'))
    } catch (e) {
      console.error(`Warning: Could not parse ${globalConfigPath}: ${e}`)
    }
  }

  const merged = deepMerge(defaultConfig(agentBaseDir), globalConfig)

  // Allow-all network sentinel: a global sandbox.json with allowedDomains: ["*"]
  // means "let the agent reach any host". The runtime's allowlist matcher only
  // understands exact and "*.domain" patterns (a literal "*" never matches), so
  // we strip the sentinel and instead flag allow-all — initializeSandbox then
  // wires up an ask-callback that approves every host. deniedDomains still
  // applies, so specific hosts can be blocked even in allow-all mode.
  if (merged.network?.allowedDomains?.includes('*')) {
    merged.allowAllNetwork = true
    merged.network = {
      ...merged.network,
      allowedDomains: merged.network.allowedDomains.filter((d) => d !== '*')
    }
  }

  // Append extra writable paths (e.g. the active workspace vault dir) AFTER the
  // merge so a global sandbox.json that overrides filesystem.allowWrite cannot
  // drop them. Only allowWrite is touched — denyWrite/denyRead stay intact.
  if (extraWritePaths.length > 0) {
    const allowWrite = [...(merged.filesystem?.allowWrite ?? [])]
    for (const path of extraWritePaths) {
      if (path && !allowWrite.includes(path)) allowWrite.push(path)
    }
    merged.filesystem = { ...merged.filesystem, allowWrite }
  }

  return merged
}

export function createSandboxedBashOps(): BashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      if (!existsSync(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}`)
      }

      const wrappedCommand = await SandboxManager.wrapWithSandbox(command)

      return new Promise((resolve, reject) => {
        const child = spawn('bash', ['-c', wrappedCommand], {
          cwd,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })

        let timedOut = false
        let timeoutHandle: NodeJS.Timeout | undefined

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true
            if (child.pid) {
              try {
                process.kill(-child.pid, 'SIGKILL')
              } catch {
                child.kill('SIGKILL')
              }
            }
          }, timeout * 1000)
        }

        child.stdout?.on('data', onData)
        child.stderr?.on('data', onData)

        child.on('error', (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          reject(err)
        })

        const onAbort = (): void => {
          if (child.pid) {
            try {
              process.kill(-child.pid, 'SIGKILL')
            } catch {
              child.kill('SIGKILL')
            }
          }
        }

        signal?.addEventListener('abort', onAbort, { once: true })

        child.on('close', (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          signal?.removeEventListener('abort', onAbort)

          if (signal?.aborted) {
            reject(new Error('aborted'))
          } else if (timedOut) {
            reject(new Error(`timeout:${timeout}`))
          } else {
            resolve({ exitCode: code })
          }
        })
      })
    }
  }
}

let sandboxInitialized = false

export async function initializeSandbox(config: SandboxConfig): Promise<boolean> {
  const platform = process.platform
  if (platform !== 'darwin' && platform !== 'linux') {
    console.log(`Sandbox not supported on ${platform}`)
    return false
  }

  if (!config.enabled) {
    console.log('Sandbox disabled via config')
    return false
  }

  try {
    const configExt = config as unknown as {
      ignoreViolations?: Record<string, string[]>
      enableWeakerNestedSandbox?: boolean
    }

    // In allow-all mode, approve any host the allowlist didn't already match.
    // deniedDomains is still checked first by the runtime, so explicit blocks win.
    const askCallback = config.allowAllNetwork ? async () => true : undefined

    await SandboxManager.initialize(
      {
        network: config.network,
        filesystem: config.filesystem,
        ripgrep: { command: resolveRgPath() },
        ignoreViolations: configExt.ignoreViolations,
        enableWeakerNestedSandbox: configExt.enableWeakerNestedSandbox
      },
      askCallback
    )

    sandboxInitialized = true
    const networkDesc = config.allowAllNetwork
      ? 'all domains (allow-all)'
      : `${config.network?.allowedDomains?.length ?? 0} allowed domains`
    const writeCount = config.filesystem?.allowWrite?.length ?? 0
    console.log(`Sandbox initialized: ${networkDesc}, ${writeCount} write paths`)
    return true
  } catch (err) {
    console.error(`Sandbox initialization failed: ${err instanceof Error ? err.message : err}`)
    return false
  }
}

export async function resetSandbox(): Promise<void> {
  if (sandboxInitialized) {
    try {
      await SandboxManager.reset()
      sandboxInitialized = false
    } catch {
      // Ignore cleanup errors
    }
  }
}

export function isSandboxInitialized(): boolean {
  return sandboxInitialized
}
