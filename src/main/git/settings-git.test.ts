import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ensureSettingsRepo,
  commitSettingsChange,
  logSettingsHistory,
  SETTINGS_GITIGNORE_CONTENTS
} from './settings-git'
import { ensureRepo, commitAll, logAll, __resetRepoQueuesForTest } from './git-service'

/**
 * Phase 4 — global-config repo rooted at `.settings/`. These exercise the db-aware
 * glue against a temp base dir; the `db` is a minimal stub since only
 * `getSetting(db, 'agentBaseDir')` is consulted to resolve the base.
 */

let base: string
let settingsDir: string

// Minimal better-sqlite3 stub: getAgentBaseDir reads the 'agentBaseDir' setting via
// a prepared statement. Return our temp base so getSettingsDir → <base>/.settings.
function makeDb(baseDir: string): { prepare: (sql: string) => unknown } {
  return {
    prepare: () => ({
      get: () => ({ value: baseDir }),
      run: () => undefined,
      all: () => []
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (): any => makeDb(base)

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gt-settings-'))
  settingsDir = join(base, '.settings')
  mkdirSync(settingsDir, { recursive: true })
  __resetRepoQueuesForTest()
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('settings-git ensureSettingsRepo', () => {
  it('inits a repo at .settings/ with the config-only .gitignore', async () => {
    await ensureSettingsRepo(db())
    expect(existsSync(join(settingsDir, '.git'))).toBe(true)
    const ignore = readFileSync(join(settingsDir, '.gitignore'), 'utf-8')
    expect(ignore).toBe(SETTINGS_GITIGNORE_CONTENTS)
    expect(ignore).toContain('.DS_Store')
    expect(ignore).toContain('node_modules/')
    // Config-only: it does NOT carry the per-workspace vault ignores.
    expect(ignore).not.toContain('.greentea/')
    expect(ignore).not.toContain('attachments/')
    // Flat list — no negation that trips isomorphic-git's matcher.
    expect(ignore).not.toContain('!')
  })

  it('is idempotent', async () => {
    await ensureSettingsRepo(db())
    await ensureSettingsRepo(db())
    expect(existsSync(join(settingsDir, '.git'))).toBe(true)
  })
})

describe('settings-git commitSettingsChange', () => {
  it('commits config files and returns an oid; a clean repo is a no-op', async () => {
    await ensureSettingsRepo(db())
    mkdirSync(join(settingsDir, 'skills'), { recursive: true })
    writeFileSync(join(settingsDir, 'mcp.json'), '{"servers":{}}', 'utf-8')
    writeFileSync(join(settingsDir, 'skills', 'a.md'), '# skill', 'utf-8')

    const oid = await commitSettingsChange(db(), 'config: initial import')
    expect(oid).toBeTruthy()

    // Nothing changed since → no empty commit.
    const again = await commitSettingsChange(db(), 'config: no change')
    expect(again).toBeNull()
  })

  it('attributes config commits to the app (not agent) identity', async () => {
    await ensureSettingsRepo(db())
    writeFileSync(join(settingsDir, 'theme.json'), '{"mode":"dark"}', 'utf-8')
    await commitSettingsChange(db(), 'config: theme edit')

    const history = await logSettingsHistory(db())
    expect(history.length).toBeGreaterThan(0)
    expect(history[0].authorName).toBe('Green Tea')
    expect(history[0].authorEmail).toBe('noreply@greentea.app')
  })

  it('captures successive config edits as separate commits', async () => {
    await ensureSettingsRepo(db())
    writeFileSync(join(settingsDir, 'mcp.json'), '{"servers":{}}', 'utf-8')
    await commitSettingsChange(db(), 'config: add mcp')
    writeFileSync(join(settingsDir, 'mcp.json'), '{"servers":{"x":{}}}', 'utf-8')
    await commitSettingsChange(db(), 'config: edit mcp')

    const history = await logSettingsHistory(db())
    // initial .gitignore commit + 2 edits (the gitignore lands with the first commit).
    expect(history.length).toBeGreaterThanOrEqual(2)
  })
})

describe('git-service per-repo .gitignore override (Phase 4 plumbing)', () => {
  it('writes the registered override and reuses it on re-create after deletion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt-override-'))
    try {
      __resetRepoQueuesForTest()
      await ensureRepo(dir, SETTINGS_GITIGNORE_CONTENTS)
      expect(readFileSync(join(dir, '.gitignore'), 'utf-8')).toBe(SETTINGS_GITIGNORE_CONTENTS)

      // Delete it, then make a commit (which calls ensureRepo internally via
      // commitUnlocked): the gitignore must be re-created from the REGISTERED
      // override, NOT the per-workspace default.
      rmSync(join(dir, '.gitignore'))
      writeFileSync(join(dir, 'mcp.json'), '{}', 'utf-8')
      const oid = await commitAll(dir, 'config: edit after gitignore deletion')
      expect(oid).toBeTruthy()
      const ignore = readFileSync(join(dir, '.gitignore'), 'utf-8')
      expect(ignore).toBe(SETTINGS_GITIGNORE_CONTENTS)
      expect(ignore).not.toContain('.greentea/')
      // The whole-tree log works on the override repo.
      expect(Array.isArray(await logAll(dir))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
