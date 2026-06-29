import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mutable mock state for Electron safeStorage, shared with the mock factory via
// vi.hoisted so it survives module resets.
const mockState = vi.hoisted(() => ({
  available: true,
  backend: 'kwallet' as string | undefined,
  hasGetBackend: true
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockState.available,
    // Only present when hasGetBackend; mirrors Linux-only availability.
    get getSelectedStorageBackend() {
      return mockState.hasGetBackend ? () => mockState.backend : undefined
    },
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8')
      if (!s.startsWith('enc:')) throw new Error('cannot decrypt (keychain reset)')
      return s.slice(4)
    }
  }
}))

import Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import {
  getSecret,
  setSecret,
  deleteSecret,
  listSecretKeys,
  reEncryptPlaintextSecrets,
  isSecureStorageAvailable
} from './index'

let db: Database.Database

function rawRow(key: string): { value: Buffer; encrypted: number } | undefined {
  const r = db.prepare('SELECT value, encrypted FROM secrets WHERE key = ?').get(key) as
    | { value: Buffer; encrypted: number }
    | undefined
  return r
}

beforeEach(() => {
  mockState.available = true
  mockState.backend = 'kwallet'
  mockState.hasGetBackend = true
  db = createTestDb()
})

describe('secrets service — encrypted path', () => {
  it('returns null for a nonexistent key', () => {
    expect(getSecret(db, 'nope')).toBeNull()
  })

  it('sets and gets a secret, round-tripping through safeStorage', () => {
    setSecret(db, 'google', 'refresh-token-123')
    expect(getSecret(db, 'google')).toBe('refresh-token-123')
  })

  it('stores ciphertext (not plaintext) with encrypted=1', () => {
    setSecret(db, 'google', 'secret-value')
    const row = rawRow('google')!
    expect(row.encrypted).toBe(1)
    expect(row.value.toString('utf8')).toBe('enc:secret-value')
    expect(row.value.toString('utf8')).not.toBe('secret-value')
  })

  it('deletes a secret', () => {
    setSecret(db, 'mcp:server-a', 'tok')
    deleteSecret(db, 'mcp:server-a')
    expect(getSecret(db, 'mcp:server-a')).toBeNull()
  })

  it('deleting a missing key is a no-op', () => {
    expect(() => deleteSecret(db, 'absent')).not.toThrow()
  })

  it('round-trips unicode and multiline payloads', () => {
    const payload = JSON.stringify({ token: 'abc', note: 'héllo\nwörld 🌱' })
    setSecret(db, 'microsoft', payload)
    expect(getSecret(db, 'microsoft')).toBe(payload)
  })
})

describe('secrets service — overwrite & timestamps', () => {
  it('overwrites in place (single row) and updates the value', () => {
    setSecret(db, 'google', 'v1')
    setSecret(db, 'google', 'v2')
    expect(getSecret(db, 'google')).toBe('v2')
    const count = db.prepare('SELECT COUNT(*) AS c FROM secrets WHERE key = ?').get('google') as {
      c: number
    }
    expect(count.c).toBe(1)
  })

  it('preserves created_at and advances updated_at on overwrite', () => {
    setSecret(db, 'google', 'v1')
    // Backdate both timestamps so datetime('now') second-granularity still shows movement.
    db.prepare("UPDATE secrets SET created_at = '2000-01-01 00:00:00', updated_at = ?").run(
      '2000-01-01 00:00:00'
    )
    setSecret(db, 'google', 'v2')
    const row = db
      .prepare('SELECT created_at, updated_at FROM secrets WHERE key = ?')
      .get('google') as { created_at: string; updated_at: string }
    expect(row.created_at).toBe('2000-01-01 00:00:00')
    expect(row.updated_at > '2000-01-01 00:00:00').toBe(true)
  })
})

describe('secrets service — listSecretKeys', () => {
  beforeEach(() => {
    setSecret(db, 'google', 'a')
    setSecret(db, 'microsoft', 'b')
    setSecret(db, 'mcp:alpha', 'c')
    setSecret(db, 'mcp:beta', 'd')
    setSecret(db, 'plugin:todo:token', 'e')
    setSecret(db, 'plugin:todo:other', 'f')
    setSecret(db, 'plugin:kanban:token', 'g')
  })

  it('lists all keys sorted when no prefix is given', () => {
    expect(listSecretKeys(db)).toEqual([
      'google',
      'mcp:alpha',
      'mcp:beta',
      'microsoft',
      'plugin:kanban:token',
      'plugin:todo:other',
      'plugin:todo:token'
    ])
  })

  it('restricts to a prefix with a range scan', () => {
    expect(listSecretKeys(db, 'mcp:')).toEqual(['mcp:alpha', 'mcp:beta'])
  })

  it('isolates a plugin namespace (does not leak sibling plugins)', () => {
    expect(listSecretKeys(db, 'plugin:todo:')).toEqual(['plugin:todo:other', 'plugin:todo:token'])
  })

  it('does not bleed across adjacent prefixes', () => {
    // 'plugin:todo' (no trailing colon) must not also match 'plugin:todos...' boundaries.
    setSecret(db, 'plugin:todox', 'h')
    expect(listSecretKeys(db, 'plugin:todo:')).toEqual(['plugin:todo:other', 'plugin:todo:token'])
  })

  it('treats SQL wildcards in the prefix literally (no LIKE injection)', () => {
    setSecret(db, '100%real', 'x')
    setSecret(db, '100Xreal', 'y')
    // A bare LIKE would treat % as "match anything"; the range scan must match
    // only the literal "100%" prefix.
    expect(listSecretKeys(db, '100%')).toEqual(['100%real'])

    setSecret(db, 'a_b', 'p')
    setSecret(db, 'aXb', 'q')
    // '_' is a single-char wildcard under LIKE; range scan treats it literally.
    expect(listSecretKeys(db, 'a_')).toEqual(['a_b'])
  })

  it('returns an empty list for a non-matching prefix', () => {
    expect(listSecretKeys(db, 'zzz:')).toEqual([])
  })
})

describe('secrets service — encryption unavailable fallback', () => {
  it('reports secure storage unavailable when isEncryptionAvailable is false', () => {
    mockState.available = false
    expect(isSecureStorageAvailable()).toBe(false)
  })

  it('treats the Linux basic_text backend as insecure', () => {
    mockState.available = true
    mockState.backend = 'basic_text'
    expect(isSecureStorageAvailable()).toBe(false)
  })

  it('stores plaintext bytes with encrypted=0 and still round-trips', () => {
    mockState.available = false
    setSecret(db, 'google', 'plain-token')
    const row = rawRow('google')!
    expect(row.encrypted).toBe(0)
    expect(row.value.toString('utf8')).toBe('plain-token')
    expect(getSecret(db, 'google')).toBe('plain-token')
  })

  it('logs the plaintext fallback warning at most once (fresh module)', async () => {
    vi.resetModules()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockState.available = false
    const mod = await import('./index')
    const d = createTestDb()
    mod.setSecret(d, 'a', '1')
    mod.setSecret(d, 'b', '2')
    const secretWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('[Secrets]'))
    expect(secretWarns.length).toBe(1)
    warnSpy.mockRestore()
  })
})

describe('secrets service — decrypt failure handling', () => {
  it('returns null (not throw) when decryption fails, e.g. keychain reset', () => {
    // An encrypted=1 row whose ciphertext can no longer be decrypted.
    db.prepare('INSERT INTO secrets (key, value, encrypted) VALUES (?, ?, 1)').run(
      'google',
      Buffer.from('garbage-not-enc', 'utf8')
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getSecret(db, 'google')).toBeNull()
    warnSpy.mockRestore()
  })
})

describe('secrets service — re-encrypt pass', () => {
  it('upgrades plaintext rows to encrypted once a secure backend is available', () => {
    // Write two plaintext rows under an unavailable backend.
    mockState.available = false
    setSecret(db, 'google', 'gtok')
    setSecret(db, 'mcp:alpha', 'atok')
    expect(rawRow('google')!.encrypted).toBe(0)

    // Secure backend comes back.
    mockState.available = true
    const upgraded = reEncryptPlaintextSecrets(db)
    expect(upgraded).toBe(2)

    const g = rawRow('google')!
    expect(g.encrypted).toBe(1)
    expect(g.value.toString('utf8')).toBe('enc:gtok')
    // Values still decrypt to the originals.
    expect(getSecret(db, 'google')).toBe('gtok')
    expect(getSecret(db, 'mcp:alpha')).toBe('atok')
  })

  it('is a no-op when there are no plaintext rows', () => {
    setSecret(db, 'google', 'enc-already')
    expect(reEncryptPlaintextSecrets(db)).toBe(0)
  })

  it('is a no-op when secure storage is unavailable', () => {
    mockState.available = false
    setSecret(db, 'google', 'gtok')
    expect(reEncryptPlaintextSecrets(db)).toBe(0)
    expect(rawRow('google')!.encrypted).toBe(0)
  })
})
