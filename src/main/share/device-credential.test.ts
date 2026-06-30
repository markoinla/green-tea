import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The device-credential module persists through the encrypted secrets store,
// which reaches Electron `safeStorage`. Mock it the same way the secrets tests
// do so the round-trip works headless (no real keychain).
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'kwallet',
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8')
      if (!s.startsWith('enc:')) throw new Error('cannot decrypt (keychain reset)')
      return s.slice(4)
    }
  }
}))

import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { getSecret, setSecret } from '../secrets'
import { getDeviceCredential, clearCachedCredential } from './device-credential'

const CREDENTIAL_KEY = 'share:deviceCredential'
const BASE_URL = 'https://share.greentea.app'

let db: Database.Database

/** Build a minimal fetch Response stand-in for the /register call. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body
  } as unknown as Response
}

beforeEach(() => {
  db = createTestDb()
  // The in-flight registration memo is module-level; reset it between tests so a
  // prior test's promise can never satisfy this one.
  clearCachedCredential()
})

afterEach(() => {
  db.close()
  vi.restoreAllMocks()
})

describe('getDeviceCredential', () => {
  it('returns the stored credential without any network call when one is cached', async () => {
    setSecret(db, CREDENTIAL_KEY, 'dev123.secretabc')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const credential = await getDeviceCredential(db, BASE_URL)

    expect(credential).toBe('dev123.secretabc')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('registers on a miss: POSTs /register, stores <deviceId>.<deviceSecret>, returns it', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ deviceId: 'devXYZ', deviceSecret: 'sec789' }))

    const credential = await getDeviceCredential(db, BASE_URL)

    expect(credential).toBe('devXYZ.sec789')
    // Hit the register endpoint with a POST.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/register`)
    expect((init as RequestInit).method).toBe('POST')
    // Persisted to the encrypted secrets store for next time.
    expect(getSecret(db, CREDENTIAL_KEY)).toBe('devXYZ.sec789')
  })

  it('trims trailing slashes from the base URL before hitting /register', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ deviceId: 'd', deviceSecret: 's' }))

    await getDeviceCredential(db, 'https://share.greentea.app///')

    expect(fetchSpy.mock.calls[0][0]).toBe('https://share.greentea.app/register')
  })

  it('throws on a non-OK register response and stores nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'rate limited' }, { ok: false, status: 429 })
    )

    await expect(getDeviceCredential(db, BASE_URL)).rejects.toThrow(/429/)
    expect(getSecret(db, CREDENTIAL_KEY)).toBeNull()
  })

  it('throws a clear error when the network request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'))

    await expect(getDeviceCredential(db, BASE_URL)).rejects.toThrow(/registration request failed/i)
    expect(getSecret(db, CREDENTIAL_KEY)).toBeNull()
  })

  it('rejects a malformed register response (missing deviceSecret)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ deviceId: 'only-id' }))

    await expect(getDeviceCredential(db, BASE_URL)).rejects.toThrow(/unexpected response/i)
    expect(getSecret(db, CREDENTIAL_KEY)).toBeNull()
  })

  it('registers exactly once for concurrent callers that all miss the cache', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ deviceId: 'devC', deviceSecret: 'secC' }))

    const [a, b, c] = await Promise.all([
      getDeviceCredential(db, BASE_URL),
      getDeviceCredential(db, BASE_URL),
      getDeviceCredential(db, BASE_URL)
    ])

    expect([a, b, c]).toEqual(['devC.secC', 'devC.secC', 'devC.secC'])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
