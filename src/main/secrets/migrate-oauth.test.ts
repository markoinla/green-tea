import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mutable safeStorage mock state, shared with the factory via vi.hoisted.
const mockState = vi.hoisted(() => ({ available: true }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockState.available,
    getSelectedStorageBackend: undefined,
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8')
      if (!s.startsWith('enc:')) throw new Error('cannot decrypt')
      return s.slice(4)
    }
  }
}))

import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestDb } from '../database/__test__/setup'
import { getSecret, setSecret } from './index'
import { migrateOAuthSecrets } from './migrate-oauth'

let db: Database.Database
let baseDir: string

const googleData = {
  tokens: {
    access_token: 'g-access',
    refresh_token: 'g-refresh',
    scope: 'calendar',
    token_type: 'Bearer',
    expiry_date: 123
  },
  scopes: ['calendar'],
  enabledServices: ['calendar'],
  codeVerifier: 'g-verifier'
}

const mcpData = {
  tokens: { access_token: 'm-access', refresh_token: 'm-refresh', token_type: 'Bearer' },
  clientInfo: { client_id: 'abc' },
  codeVerifier: 'm-verifier'
}

function writeFile(rel: string, obj: unknown): string {
  const file = join(baseDir, rel)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(obj, null, 2))
  return file
}

function rowEncrypted(key: string): number | undefined {
  const r = db.prepare('SELECT encrypted FROM secrets WHERE key = ?').get(key) as
    | { encrypted: number }
    | undefined
  return r?.encrypted
}

beforeEach(() => {
  mockState.available = true
  db = createTestDb()
  baseDir = mkdtempSync(join(tmpdir(), 'gt-migrate-'))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe('migrateOAuthSecrets — encrypted path', () => {
  it('migrates google/microsoft/mcp, verifies, and deletes the plaintext sources', () => {
    const gFile = writeFile('google-auth/tokens.json', googleData)
    const mFile = writeFile('microsoft-auth/tokens.json', { ...googleData, codeVerifier: 'ms' })
    const mcpFile = writeFile('mcp-auth/my-server.json', mcpData)

    migrateOAuthSecrets(db, baseDir)

    expect(JSON.parse(getSecret(db, 'google')!)).toEqual(googleData)
    expect(getSecret(db, 'microsoft')).not.toBeNull()
    expect(JSON.parse(getSecret(db, 'mcp:my-server')!)).toEqual(mcpData)

    // Plaintext sources gone, dirs reclaimed.
    expect(existsSync(gFile)).toBe(false)
    expect(existsSync(mFile)).toBe(false)
    expect(existsSync(mcpFile)).toBe(false)
    expect(existsSync(join(baseDir, 'google-auth'))).toBe(false)
    expect(existsSync(join(baseDir, 'mcp-auth'))).toBe(false)
  })

  it('sanitizes mcp filenames into mcp:<safe> keys', () => {
    writeFile('mcp-auth/weird name@v2.json', mcpData)
    migrateOAuthSecrets(db, baseDir)
    expect(getSecret(db, 'mcp:weird_name_v2')).not.toBeNull()
  })

  it('is idempotent — a second run is a clean no-op', () => {
    writeFile('google-auth/tokens.json', googleData)
    migrateOAuthSecrets(db, baseDir)
    const first = getSecret(db, 'google')
    expect(() => migrateOAuthSecrets(db, baseDir)).not.toThrow()
    expect(getSecret(db, 'google')).toBe(first)
  })

  it('skips a key that already exists in the store (no overwrite)', () => {
    setSecret(db, 'google', JSON.stringify({ pre: 'existing' }))
    writeFile('google-auth/tokens.json', googleData)
    migrateOAuthSecrets(db, baseDir)
    // The pre-existing value is preserved; the file is left because it does not
    // verify against the stored secret.
    expect(JSON.parse(getSecret(db, 'google')!)).toEqual({ pre: 'existing' })
    expect(existsSync(join(baseDir, 'google-auth/tokens.json'))).toBe(true)
  })

  it('leaves an unreadable/invalid source file in place', () => {
    const file = join(baseDir, 'google-auth/tokens.json')
    mkdirSync(join(baseDir, 'google-auth'), { recursive: true })
    writeFileSync(file, '{ not valid json')
    migrateOAuthSecrets(db, baseDir)
    expect(getSecret(db, 'google')).toBeNull()
    expect(existsSync(file)).toBe(true)
  })

  it('does nothing when there are no legacy files', () => {
    expect(() => migrateOAuthSecrets(db, baseDir)).not.toThrow()
    expect(getSecret(db, 'google')).toBeNull()
  })
})

describe('migrateOAuthSecrets — plaintext-fallback safety', () => {
  it('migrates into the store but LEAVES plaintext files when storage is insecure', () => {
    mockState.available = false
    const gFile = writeFile('google-auth/tokens.json', googleData)

    migrateOAuthSecrets(db, baseDir)

    // Secret is present (so integrations work) but stored unencrypted...
    expect(JSON.parse(getSecret(db, 'google')!)).toEqual(googleData)
    expect(rowEncrypted('google')).toBe(0)
    // ...and crucially the plaintext source is NOT deleted.
    expect(existsSync(gFile)).toBe(true)
  })

  it('unlinks the source on a later secure startup (self-healing)', () => {
    mockState.available = false
    const gFile = writeFile('google-auth/tokens.json', googleData)
    migrateOAuthSecrets(db, baseDir)
    expect(existsSync(gFile)).toBe(true)

    // Secure backend returns; re-encrypt the row, then the ensure-source-absent
    // pass should now remove the plaintext file.
    mockState.available = true
    // Simulate the startup order in index.ts: re-encrypt happens before migrate.
    db.prepare("UPDATE secrets SET value = ?, encrypted = 1 WHERE key = 'google'").run(
      Buffer.from('enc:' + JSON.stringify(googleData), 'utf8')
    )
    migrateOAuthSecrets(db, baseDir)
    expect(existsSync(gFile)).toBe(false)
  })
})

describe('migrateOAuthSecrets — verify before unlink', () => {
  it('does not unlink when the stored secret differs from the source', () => {
    // A stored (encrypted) secret that does NOT match the on-disk file.
    setSecret(db, 'google', JSON.stringify({ different: true }))
    const file = writeFile('google-auth/tokens.json', googleData)
    migrateOAuthSecrets(db, baseDir)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf-8')).toContain('g-refresh')
  })
})
