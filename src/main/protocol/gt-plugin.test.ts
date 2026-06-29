import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getVersion: () => '6.2.1',
    getAppPath: () => process.cwd()
  }
}))

import type Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { GT_PLUGIN_SCHEME, GT_PLUGIN_PRIVILEGE, createGtPluginHandler } from './gt-plugin'
import { buildGtFileCsp } from './gt-file'

let db: Database.Database
let baseDir: string
let pluginsDir: string
let pluginDir: string
let outsideDir: string

const PLUGIN_ID = 'mermaid'

beforeEach(() => {
  db = createTestDb()

  baseDir = mkdtempSync(join(tmpdir(), 'gt-plugin-base-'))
  outsideDir = mkdtempSync(join(tmpdir(), 'gt-plugin-out-'))
  setSetting(db, 'agentBaseDir', baseDir)

  pluginsDir = join(baseDir, 'plugins')
  pluginDir = join(pluginsDir, PLUGIN_ID)
  mkdirSync(pluginDir, { recursive: true })

  writeFileSync(join(pluginDir, 'viewer.html'), '<html><body>viewer</body></html>')
  writeFileSync(join(pluginDir, 'app.js'), 'console.log("plugin")')
  writeFileSync(join(outsideDir, 'secret.txt'), 'TOP SECRET')
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
  rmSync(outsideDir, { recursive: true, force: true })
})

describe('scheme registration contract', () => {
  it('uses the gt-plugin scheme, no bypassCSP', () => {
    expect(GT_PLUGIN_SCHEME).toBe('gt-plugin')
    expect(GT_PLUGIN_PRIVILEGE.scheme).toBe('gt-plugin')
    expect(GT_PLUGIN_PRIVILEGE.privileges).toMatchObject({
      standard: true,
      secure: true,
      supportFetchAPI: true
    })
    expect('bypassCSP' in GT_PLUGIN_PRIVILEGE.privileges).toBe(false)
  })
})

describe('createGtPluginHandler', () => {
  function req(path: string): GlobalRequest {
    return new Request(`gt-plugin://${PLUGIN_ID}${path}`) as unknown as GlobalRequest
  }

  it('serves an in-dir asset with html mime + CSP header', async () => {
    const handle = createGtPluginHandler(db)
    const res = await handle(req('/viewer.html'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html')
    expect(res.headers.get('Content-Security-Policy')).toBe(buildGtFileCsp())
    expect(await res.text()).toContain('viewer')
  })

  it('serves a js asset with text/javascript (no CSP header)', async () => {
    const handle = createGtPluginHandler(db)
    const res = await handle(req('/app.js'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/javascript')
    expect(res.headers.get('Content-Security-Policy')).toBeNull()
    expect(await res.text()).toBe('console.log("plugin")')
  })

  it('rejects the root pathname (no implicit entry)', async () => {
    const handle = createGtPluginHandler(db)
    const res = await handle(req('/'))
    expect(res.status).toBe(404)
  })

  it('404s on ../ traversal escape', async () => {
    const handle = createGtPluginHandler(db)
    const res = await handle(req('/../../secret.txt'))
    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Security-Policy')).toBe(buildGtFileCsp())
  })

  it('404s on percent-encoded traversal', async () => {
    const handle = createGtPluginHandler(db)
    const res = await handle(req('/%2e%2e/%2e%2e/secret.txt'))
    expect(res.status).toBe(404)
  })

  it('404s on an escaping symlink', async () => {
    symlinkSync(join(outsideDir, 'secret.txt'), join(pluginDir, 'escape.txt'))
    const handle = createGtPluginHandler(db)
    const res = await handle(req('/escape.txt'))
    expect(res.status).toBe(404)
  })

  it('404s for a missing asset', async () => {
    const handle = createGtPluginHandler(db)
    const res = await handle(req('/nope.js'))
    expect(res.status).toBe(404)
  })

  it('404s for an unknown plugin id', async () => {
    const handle = createGtPluginHandler(db)
    const res = await handle(
      new Request('gt-plugin://does-not-exist/viewer.html') as unknown as GlobalRequest
    )
    expect(res.status).toBe(404)
  })
})
