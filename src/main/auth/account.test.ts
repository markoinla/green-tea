import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'crypto'

// account.ts persists through the encrypted secrets store (safeStorage) and opens
// the system browser via shell.openExternal. Mock both the same way the secrets /
// device-credential tests do so the round-trip works headless.
const openExternalMock = vi.fn<(url: string) => Promise<void>>()

// account.ts probes for installed Chromium binaries with fs.existsSync and, when one
// is found, spawns a REAL `--app` browser window instead of shell.openExternal.
// Pretend no Chromium is installed so openAuthWindow falls through to the mocked
// shell.openExternal and the flow stays headless on machines with Chrome.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const existsSync = (path: Parameters<typeof actual.existsSync>[0]): boolean =>
    String(path).startsWith('/Applications/') ? false : actual.existsSync(path)
  return { ...actual, existsSync, default: { ...actual, existsSync } }
})

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
  },
  shell: {
    openExternal: (url: string) => openExternalMock(url)
  }
}))

import type Database from 'better-sqlite3'
import { createTestDb } from '../database/__test__/setup'
import { getSecret, setSecret } from '../secrets'
import { signIn, signOut, getAccount } from './account'

const ACCOUNT_TOKEN_KEY = 'account:token'
const DEVICE_CREDENTIAL_KEY = 'share:deviceCredential'

let db: Database.Database

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

/** The S256 challenge the worker would compute for a given verifier. */
function s256(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

beforeEach(() => {
  db = createTestDb()
  openExternalMock.mockReset()
  process.env.ACCOUNT_BASE_URL = 'https://account.test'
})

afterEach(() => {
  db.close()
  vi.restoreAllMocks()
  delete process.env.ACCOUNT_BASE_URL
})

/**
 * Drive one full sign-in: intercept openExternal to read the redirect/state/challenge
 * the client minted, then hit the client's own loopback `/callback` with a
 * caller-supplied `state`, and stub `/auth/desktop/token`. Returns the sign-in result
 * plus what the token endpoint received.
 */
async function runSignIn(options: {
  /** Override the state echoed back on the callback (defaults to the real minted state). */
  callbackState?: (mintedState: string) => string
  tokenResponse?: { ok: boolean; status?: number; body: unknown }
}): Promise<{
  result: Awaited<ReturnType<typeof signIn>>
  tokenBody: Record<string, unknown> | null
  challenge: string | null
}> {
  let tokenBody: Record<string, unknown> | null = null
  let challenge: string | null = null

  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/auth/desktop/token')) {
      tokenBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      const t = options.tokenResponse ?? {
        ok: true,
        body: { token: 'acct_tok_123', user: { id: 'u1', email: 'a@b.co' } }
      }
      return {
        ok: t.ok,
        status: t.status ?? (t.ok ? 200 : 400),
        json: async () => t.body
      } as unknown as Response
    }
    throw new Error(`unexpected fetch ${url}`)
  })

  // When the client opens the browser, parse the URL and immediately hit its loopback.
  openExternalMock.mockImplementation(async (url: string) => {
    const parsed = new URL(url)
    const redirect = parsed.searchParams.get('redirect')!
    const mintedState = parsed.searchParams.get('state')!
    challenge = parsed.searchParams.get('code_challenge')
    const echoState = options.callbackState ? options.callbackState(mintedState) : mintedState

    const cbUrl = new URL(redirect)
    cbUrl.searchParams.set('code', 'one_time_code')
    cbUrl.searchParams.set('state', echoState)
    // Fire the loopback callback out-of-band; ignore its HTML response.
    await realFetch(cbUrl.toString())
  })

  const result = await signIn(db)
  fetchSpy.mockRestore()
  return { result, tokenBody, challenge }
}

// account.ts's loopback is a real http server, so the callback probe must use the
// real fetch, not the mocked one.
const realFetch = globalThis.fetch.bind(globalThis)

describe('signIn', () => {
  it('mints a valid S256 PKCE challenge for the verifier it later submits', async () => {
    const { result, tokenBody, challenge } = await runSignIn({})
    expect(result).toEqual({ success: true, user: { id: 'u1', email: 'a@b.co' } })
    expect(tokenBody).toBeTruthy()
    const verifier = tokenBody!.code_verifier as string
    expect(typeof verifier).toBe('string')
    expect(challenge).toBe(s256(verifier))
  })

  it('stores the returned bearer under account:token', async () => {
    await runSignIn({})
    expect(getSecret(db, ACCOUNT_TOKEN_KEY)).toBe('acct_tok_123')
  })

  it('rejects a mismatched state and never stores a token', async () => {
    const { result, tokenBody } = await runSignIn({
      callbackState: () => 'attacker-state'
    })
    expect(result).toEqual({ success: false, error: expect.stringMatching(/state mismatch/i) })
    expect(tokenBody).toBeNull()
    expect(getSecret(db, ACCOUNT_TOKEN_KEY)).toBeNull()
  })

  it('presents the stored device credential (split on first dot) when one exists', async () => {
    setSecret(db, DEVICE_CREDENTIAL_KEY, 'dev-id.secret.with.dots')
    const { tokenBody } = await runSignIn({})
    expect(tokenBody!.device).toEqual({ id: 'dev-id', secret: 'secret.with.dots' })
  })

  it('omits device when no share credential exists', async () => {
    const { tokenBody } = await runSignIn({})
    expect(tokenBody!.device).toBeUndefined()
  })
})

describe('signOut', () => {
  it('deletes the local token and best-effort revokes on the server', async () => {
    setSecret(db, ACCOUNT_TOKEN_KEY, 'acct_tok_123')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true } as unknown as Response)

    const out = await signOut(db)

    expect(out).toEqual({ revoked: true })
    expect(getSecret(db, ACCOUNT_TOKEN_KEY)).toBeNull()
    const call = fetchSpy.mock.calls[0]
    expect(String(call[0])).toBe('https://account.test/auth/desktop/revoke')
    expect((call[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer acct_tok_123'
    })
  })

  it('still deletes the local token when the server revoke fails', async () => {
    setSecret(db, ACCOUNT_TOKEN_KEY, 'acct_tok_123')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))

    const out = await signOut(db)

    expect(out).toEqual({ revoked: false })
    expect(getSecret(db, ACCOUNT_TOKEN_KEY)).toBeNull()
  })
})

describe('getAccount', () => {
  it('returns null with no stored token (no network call)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await getAccount(db)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('resolves the user from a valid session', async () => {
    setSecret(db, ACCOUNT_TOKEN_KEY, 'acct_tok_123')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: 'u1', email: 'a@b.co', name: 'A' } })
    } as unknown as Response)

    expect(await getAccount(db)).toEqual({ id: 'u1', email: 'a@b.co', name: 'A' })
  })

  it('returns null on an invalid/expired token', async () => {
    setSecret(db, ACCOUNT_TOKEN_KEY, 'acct_tok_123')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401
    } as unknown as Response)

    expect(await getAccount(db)).toBeNull()
  })
})
