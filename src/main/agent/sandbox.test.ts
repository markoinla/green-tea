/**
 * Sandbox lifecycle tests: concurrent sessions register per-scope configs
 * against one shared SandboxManager (union config, reference-counted reset)
 * and bash ops pass their scope's filesystem as a per-command customConfig.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'

const h = vi.hoisted(() => {
  const state = { config: undefined as SandboxRuntimeConfig | undefined }
  return {
    state,
    initialize: vi.fn(async (cfg: SandboxRuntimeConfig) => {
      state.config = cfg
    }),
    updateConfig: vi.fn((cfg: SandboxRuntimeConfig) => {
      state.config = cfg
    }),
    reset: vi.fn(async () => {
      state.config = undefined
    }),
    wrapWithSandbox: vi.fn(async () => 'true')
  }
})

vi.mock('@anthropic-ai/sandbox-runtime', () => ({
  SandboxManager: {
    initialize: h.initialize,
    updateConfig: h.updateConfig,
    reset: h.reset,
    wrapWithSandbox: h.wrapWithSandbox,
    getConfig: () => h.state.config
  }
}))
vi.mock('@vscode/ripgrep', () => ({ rgPath: '/bin/ls' }))
vi.mock('../python', () => ({ getPythonUserBaseDir: (): string => '/tmp/gt-python-user-base' }))

type SandboxModule = typeof import('./sandbox')

async function freshSandbox(): Promise<SandboxModule> {
  vi.resetModules()
  return import('./sandbox')
}

function cfg(allowWrite: string[]): import('./sandbox').SandboxConfig {
  return {
    enabled: true,
    network: { allowedDomains: ['example.com'], deniedDomains: [] },
    filesystem: { denyRead: ['~/.ssh'], allowWrite, denyWrite: ['.env'] }
  }
}

beforeEach(() => {
  h.state.config = undefined
  h.initialize.mockClear()
  h.updateConfig.mockClear()
  h.reset.mockClear()
  h.wrapWithSandbox.mockClear()
})

describe('initializeSandbox scope registration', () => {
  it('initializes once, then widens the union via updateConfig for later scopes', async () => {
    const sandbox = await freshSandbox()

    expect(await sandbox.initializeSandbox(cfg(['/base', '/vault-a']), 'chat:a')).toBe(true)
    expect(h.initialize).toHaveBeenCalledTimes(1)
    expect(h.state.config?.filesystem.allowWrite).toEqual(['/base', '/vault-a'])

    expect(await sandbox.initializeSandbox(cfg(['/base', '/vault-b']), 'task:b')).toBe(true)
    // Manager.initialize is first-caller-wins, so the second scope must go
    // through updateConfig — not a second initialize.
    expect(h.initialize).toHaveBeenCalledTimes(1)
    expect(h.updateConfig).toHaveBeenCalledTimes(1)
    expect(h.state.config?.filesystem.allowWrite).toEqual(['/base', '/vault-a', '/vault-b'])
  })

  it('is a no-op when re-initialized with an unchanged config', async () => {
    const sandbox = await freshSandbox()

    await sandbox.initializeSandbox(cfg(['/base', '/vault-a']), 'chat:a')
    await sandbox.initializeSandbox(cfg(['/base', '/vault-a']), 'chat:a')

    expect(h.initialize).toHaveBeenCalledTimes(1)
    expect(h.updateConfig).not.toHaveBeenCalled()
  })

  it('serializes concurrent first-time initializations into one manager init', async () => {
    const sandbox = await freshSandbox()

    const [a, b] = await Promise.all([
      sandbox.initializeSandbox(cfg(['/base', '/vault-a']), 'chat:a'),
      sandbox.initializeSandbox(cfg(['/base', '/vault-b']), 'chat:b')
    ])

    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(h.initialize).toHaveBeenCalledTimes(1)
    expect(h.state.config?.filesystem.allowWrite).toEqual(['/base', '/vault-a', '/vault-b'])
  })
})

describe('resetSandbox reference counting', () => {
  it('keeps the manager alive while another scope is active, tears down on last release', async () => {
    const sandbox = await freshSandbox()
    await sandbox.initializeSandbox(cfg(['/base', '/vault-a']), 'chat:a')
    await sandbox.initializeSandbox(cfg(['/base', '/vault-b']), 'task:b')

    await sandbox.resetSandbox('chat:a')
    expect(h.reset).not.toHaveBeenCalled()
    expect(sandbox.isSandboxInitialized()).toBe(true)
    // Union narrowed back down for scope-less callers.
    expect(h.state.config?.filesystem.allowWrite).toEqual(['/base', '/vault-b'])

    await sandbox.resetSandbox('task:b')
    expect(h.reset).toHaveBeenCalledTimes(1)
    expect(sandbox.isSandboxInitialized()).toBe(false)
  })

  it('refuses a blanket reset while named scopes are still active', async () => {
    const sandbox = await freshSandbox()
    await sandbox.initializeSandbox(cfg(['/base', '/vault-a']), 'task:a')

    await sandbox.resetSandbox()
    expect(h.reset).not.toHaveBeenCalled()
    expect(sandbox.isSandboxInitialized()).toBe(true)
  })

  it('releasing an unknown scope leaves the manager untouched', async () => {
    const sandbox = await freshSandbox()
    await sandbox.initializeSandbox(cfg(['/base', '/vault-a']), 'chat:a')

    await sandbox.resetSandbox('chat:never-registered')
    expect(h.reset).not.toHaveBeenCalled()
    expect(h.updateConfig).not.toHaveBeenCalled()
    expect(sandbox.isSandboxInitialized()).toBe(true)
  })
})

describe('createSandboxedBashOps per-scope filesystem', () => {
  it("passes the scope's filesystem as wrapWithSandbox customConfig", async () => {
    const sandbox = await freshSandbox()
    await sandbox.initializeSandbox(cfg(['/base', '/vault-a']), 'chat:a')
    await sandbox.initializeSandbox(cfg(['/base', '/vault-b']), 'chat:b')

    const cwd = mkdtempSync(join(tmpdir(), 'gt-sandbox-test-'))
    const ops = sandbox.createSandboxedBashOps('chat:b')
    const result = await ops.exec('echo hi', cwd, { onData: () => {} })

    expect(result.exitCode).toBe(0)
    expect(h.wrapWithSandbox).toHaveBeenCalledWith('echo hi', undefined, {
      filesystem: { denyRead: ['~/.ssh'], allowWrite: ['/base', '/vault-b'], denyWrite: ['.env'] }
    })
  })

  it('falls back to the global union config for scope-less callers', async () => {
    const sandbox = await freshSandbox()
    await sandbox.initializeSandbox(cfg(['/base', '/vault-a']), 'chat:a')

    const cwd = mkdtempSync(join(tmpdir(), 'gt-sandbox-test-'))
    const ops = sandbox.createSandboxedBashOps()
    await ops.exec('echo hi', cwd, { onData: () => {} })

    expect(h.wrapWithSandbox).toHaveBeenCalledWith('echo hi', undefined, undefined)
  })
})
