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
import { getPythonUserBaseDir } from '../python'

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

export interface SandboxConfig extends SandboxRuntimeConfig {
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
        // pip resolves package metadata on pypi.org but downloads the actual
        // wheels from files.pythonhosted.org — both must be allowed or
        // `pip install` hangs/fails at the download step.
        'files.pythonhosted.org',
        '*.pythonhosted.org',
        'github.com',
        '*.github.com',
        'api.github.com',
        'raw.githubusercontent.com'
      ],
      deniedDomains: []
    },
    filesystem: {
      denyRead: ['~/.ssh', '~/.aws', '~/.gnupg'],
      // Python user base is writable so the agent's runtime `pip install --user`
      // can land packages there (the bundled interpreter's own site-packages is
      // inside the read-only app bundle).
      allowWrite: [agentBaseDir, getPythonUserBaseDir()],
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

export function createSandboxedBashOps(scopeKey?: string): BashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      if (!existsSync(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}`)
      }

      // Scope the filesystem profile to this session's registered config at
      // wrap time — wrapWithSandbox's per-command customConfig replaces the
      // global filesystem section wholesale, so each session writes only
      // inside its own workspace even when sessions for other workspaces are
      // live. Scope-less callers (e.g. subagent bash ops) fall back to the
      // global union config, which covers every active workspace.
      const scoped = scopeKey !== undefined ? scopeConfigs.get(scopeKey) : undefined
      const wrappedCommand = await SandboxManager.wrapWithSandbox(
        command,
        undefined,
        scoped?.filesystem ? { filesystem: scoped.filesystem } : undefined
      )

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

// ---- Sandbox lifecycle ------------------------------------------------------
//
// SandboxManager is process-global and its initialize() is first-caller-wins:
// once the network proxy is up, later initialize() calls await the existing
// promise and return WITHOUT applying their config. Foreground chat sessions,
// new conversations and background scheduled tasks — possibly for different
// workspaces — all initialize the sandbox concurrently, so with naive global
// init the second workspace's vault dir never lands in allowWrite (its bash
// writes get denied) and a blanket reset tears the proxy down under another
// session's in-flight commands.
//
// Fix — a hybrid of options (a) and (b), both of which the runtime supports:
// - Per-scope filesystem isolation (a): wrapWithSandbox() accepts a
//   per-command customConfig whose filesystem section replaces the global one
//   at profile-generation time. Each session registers its workspace-scoped
//   config under a scope key ("chat:<conversationId>" / "task:<runId>") and
//   its bash ops pass that config on every command, so a session can only
//   write inside its own workspace regardless of what else is running.
// - Reference-counted shared manager (b): the global manager (network proxy +
//   fallback filesystem config for scope-less callers such as subagent bash
//   ops) is initialized once and kept in sync with the UNION of all
//   registered scopes' allowWrite via updateConfig(). resetSandbox(scopeKey)
//   releases one scope; the proxy is only torn down when no scope remains, so
//   a chat reset can no longer kill the sandbox under a running scheduled task.
//
// All lifecycle transitions are serialized through a promise queue so
// concurrent session creation/teardown cannot interleave manager calls.

let sandboxInitialized = false
const scopeConfigs = new Map<string, SandboxConfig>()
let lifecycleQueue: Promise<unknown> = Promise.resolve()

// Scope used by legacy callers that don't pass a scope key.
const DEFAULT_SCOPE = '__default__'

function runSerialized<T>(op: () => Promise<T>): Promise<T> {
  const next = lifecycleQueue.then(op, op)
  lifecycleQueue = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

function toRuntimeConfig(config: SandboxConfig): SandboxRuntimeConfig {
  const configExt = config as unknown as {
    ignoreViolations?: Record<string, string[]>
    enableWeakerNestedSandbox?: boolean
  }
  return {
    network: config.network,
    filesystem: config.filesystem,
    ripgrep: { command: resolveRgPath() },
    ignoreViolations: configExt.ignoreViolations,
    enableWeakerNestedSandbox: configExt.enableWeakerNestedSandbox
  }
}

// Union of all registered scopes. Only allowWrite varies between scopes (it
// carries the per-workspace vault dir); network and deny lists come from the
// same defaults + global sandbox.json, so the most recent registration serves
// as the base.
function buildUnionConfig(): SandboxConfig {
  const configs = [...scopeConfigs.values()]
  const base = configs[configs.length - 1]
  const allowWrite: string[] = []
  for (const config of configs) {
    for (const path of config.filesystem?.allowWrite ?? []) {
      if (!allowWrite.includes(path)) allowWrite.push(path)
    }
  }
  return { ...base, filesystem: { ...base.filesystem, allowWrite } }
}

export async function initializeSandbox(
  config: SandboxConfig,
  scopeKey: string = DEFAULT_SCOPE
): Promise<boolean> {
  const platform = process.platform
  if (platform !== 'darwin' && platform !== 'linux') {
    console.log(`Sandbox not supported on ${platform}`)
    return false
  }

  if (!config.enabled) {
    console.log('Sandbox disabled via config')
    return false
  }

  return runSerialized(async () => {
    scopeConfigs.set(scopeKey, config)
    try {
      const union = buildUnionConfig()
      if (!sandboxInitialized) {
        // In allow-all mode, approve any host the allowlist didn't already match.
        // deniedDomains is still checked first by the runtime, so explicit blocks win.
        const askCallback = union.allowAllNetwork ? async () => true : undefined

        await SandboxManager.initialize(toRuntimeConfig(union), askCallback)

        sandboxInitialized = true
        const networkDesc = union.allowAllNetwork
          ? 'all domains (allow-all)'
          : `${union.network?.allowedDomains?.length ?? 0} allowed domains`
        const writeCount = union.filesystem?.allowWrite?.length ?? 0
        console.log(`Sandbox initialized: ${networkDesc}, ${writeCount} write paths`)
      } else {
        // Manager already live: initialize() would silently no-op, so push the
        // widened union through updateConfig instead. No-op when unchanged so
        // repeated init for the same workspace set costs nothing.
        const next = toRuntimeConfig(union)
        if (JSON.stringify(SandboxManager.getConfig()) !== JSON.stringify(next)) {
          SandboxManager.updateConfig(next)
          const writeCount = union.filesystem?.allowWrite?.length ?? 0
          console.log(`Sandbox config updated: ${writeCount} write paths`)
        }
      }
      return true
    } catch (err) {
      scopeConfigs.delete(scopeKey)
      console.error(`Sandbox initialization failed: ${err instanceof Error ? err.message : err}`)
      return false
    }
  })
}

export async function resetSandbox(scopeKey?: string): Promise<void> {
  return runSerialized(async () => {
    if (scopeKey !== undefined) {
      if (!scopeConfigs.delete(scopeKey)) return
    } else {
      // Legacy full-reset: only the default scope is ours to release. Refuse
      // to tear down while named scopes (other sessions / scheduled tasks)
      // are still active — their in-flight commands depend on the proxy.
      scopeConfigs.delete(DEFAULT_SCOPE)
      if (scopeConfigs.size > 0) {
        console.log(`Sandbox reset deferred: ${scopeConfigs.size} active scope(s)`)
        return
      }
    }

    if (!sandboxInitialized) return
    try {
      if (scopeConfigs.size === 0) {
        await SandboxManager.reset()
        sandboxInitialized = false
      } else {
        // Narrow the shared union config back down for scope-less callers.
        SandboxManager.updateConfig(toRuntimeConfig(buildUnionConfig()))
      }
    } catch {
      // Ignore cleanup errors
    }
  })
}

export function isSandboxInitialized(): boolean {
  return sandboxInitialized
}
