import { createServer } from 'http'
import { randomBytes, createHash } from 'crypto'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { shell } from 'electron'
import type Database from 'better-sqlite3'
import { getSecret, setSecret, deleteSecret } from '../secrets'
import type {
  AccountUser,
  DesktopTokenRequest,
  DesktopTokenResponse
} from '../../shared/share-contract'

/**
 * Marketplace account sign-in (auth layer one, client side).
 *
 * This is the system-browser + loopback + PKCE machinery cloned from
 * `src/main/google/auth.ts`, re-pointed at the worker's desktop auth endpoints
 * (`/auth/desktop/google` kickoff, `/auth/desktop/authorize` callback) and the
 * `/auth/desktop/token` exchange (RFC 8252 native-app OAuth). There is no hosted
 * sign-in page — the provider chooser/email entry live in-app; only Google's own
 * consent screen appears in the browser. The internals of
 * `google/auth.ts` are module-private, so this is a deliberate copy rather than an
 * import — the two concerns (Google *data* APIs vs. Green Tea *account* identity)
 * are separate and evolve independently.
 *
 * The resulting bearer (a revocable Better Auth apiKey minted per device) is stored
 * in the encrypted secrets store under {@link ACCOUNT_TOKEN_KEY} — never in
 * `settings`. The app stays fully functional with no account; identity is additive.
 */

/** Encrypted secrets key holding the account bearer (safeStorage-encrypted). */
const ACCOUNT_TOKEN_KEY = 'account:token'

/**
 * The raw account bearer for outgoing Authorization headers (registry publish,
 * report, install accounting), or null when signed out. Local-only and
 * synchronous — unlike {@link getAccount}, this never makes a network call, so
 * it is safe to call per request. Callers must never persist or log the value.
 */
export function getAccountToken(db: Database.Database): string | null {
  return getSecret(db, ACCOUNT_TOKEN_KEY)
}

/**
 * The per-device share credential, if this device has ever published. Stored as
 * `<deviceId>.<deviceSecret>`; presented to `/auth/desktop/token` so the worker can
 * link `devices.user_id` to the signed-in account. We only *read* it — signing in
 * must never trigger device registration.
 */
const DEVICE_CREDENTIAL_KEY = 'share:deviceCredential'

const DEFAULT_ACCOUNT_BASE_URL = 'https://account.greentea.app'

/**
 * The account worker origin. Dedicated `account.greentea.app` (routed to the same
 * worker as share.greentea.app), hardcoded, with an env override for dev/self-host —
 * mirrors the `SHARE_BASE_URL` convention in `share/share-service.ts`.
 */
function resolveAccountBaseUrl(): string {
  return (process.env.ACCOUNT_BASE_URL || DEFAULT_ACCOUNT_BASE_URL).replace(/\/+$/, '')
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function generateState(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Chromium `--app` binaries (macOS). Opening the user's real Chrome/Chromium in
 * app mode gives a chromeless window (traffic lights + slim URL bar, no tabs)
 * that reuses their existing Google sessions — and, crucially, it is a *genuine*
 * browser, so Google serves the OAuth consent normally instead of blocking it
 * the way it blocks embedded webviews.
 */
const CHROMIUM_APP_BINARIES_DARWIN = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
]

/**
 * Open `url` in a chromeless Chromium `--app` window when one is available, else
 * fall back to the default browser. Never throws — a spawn failure falls through
 * to `shell.openExternal`.
 */
async function openAuthWindow(url: string): Promise<void> {
  if (process.platform === 'darwin') {
    const bin = CHROMIUM_APP_BINARIES_DARWIN.find((p) => existsSync(p))
    if (bin) {
      try {
        const child = spawn(bin, [`--app=${url}`], { detached: true, stdio: 'ignore' })
        child.unref()
        return
      } catch {
        // fall through to the default browser
      }
    }
  }
  await shell.openExternal(url)
}

/**
 * The device credential to present at token exchange, parsed from the stored
 * `<deviceId>.<deviceSecret>` string. Returns undefined when this device has no
 * share credential yet (do NOT register one here). Split on the FIRST dot only —
 * the secret half is opaque and may itself contain dots.
 */
function getStoredDevice(db: Database.Database): { id: string; secret: string } | undefined {
  const raw = getSecret(db, DEVICE_CREDENTIAL_KEY)
  if (!raw) return undefined
  const dot = raw.indexOf('.')
  if (dot <= 0 || dot >= raw.length - 1) return undefined
  return { id: raw.slice(0, dot), secret: raw.slice(dot + 1) }
}

interface CallbackResult {
  code: string
  state: string
}

interface CallbackServer {
  /** The loopback URL the worker must 302 back to: `http://127.0.0.1:{port}/callback`. */
  redirectUri: string
  waitForCallback(): Promise<CallbackResult>
  close(): void
}

/**
 * The little HTML page shown in the browser tab that catches the loopback
 * redirect. Branded to match greentea.app (Outfit + Plus Jakarta Sans, #fafafa
 * ground, #3d9a72 green, the tea-leaf mark) instead of bare system-ui text. All
 * copy is static (no interpolation of untrusted input). The success page
 * best-effort self-closes — Chrome only honors `window.close()` for
 * script-opened windows, so an OS-launched `--app` window usually ignores it and
 * the app just steals focus back (see the caller).
 */
function callbackPage(opts: { heading: string; message: string; selfClose?: boolean }): string {
  const selfClose = opts.selfClose
    ? '<script>function c(){try{window.close()}catch(e){}}c();setTimeout(c,300);setTimeout(c,1000)</script>'
    : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Green Tea</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #fafafa; color: #1a1a1a;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; padding: 2rem; -webkit-font-smoothing: antialiased;
  }
  .mark {
    width: 72px; height: 72px; margin-bottom: 1.75rem;
    filter: drop-shadow(0 0 40px rgba(61, 154, 114, 0.18));
  }
  .mark path { fill: #3d9a72; }
  h1 {
    font-family: 'Outfit', sans-serif; font-weight: 500; font-size: 1.875rem;
    letter-spacing: -0.02em; color: #111111;
  }
  p {
    margin-top: 0.75rem; font-size: 1rem; font-weight: 400;
    color: #6b7472; letter-spacing: 0.01em; max-width: 26rem;
  }
</style>
</head>
<body>
  <svg class="mark" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 128 128"><path d="M50.4 78.5a75.1 75.1 0 0 0-28.5 6.9l24.2-65.7c.7-2 1.9-3.2 3.4-3.2h29c1.5 0 2.7 1.2 3.4 3.2l24.2 65.7s-11.6-7-28.5-7L67 45.5c-.4-1.7-1.6-2.8-2.9-2.8-1.3 0-2.5 1.1-2.9 2.7L50.4 78.5Zm-1.1 28.2Zm-4.2-20.2c-2 6.6-.6 15.8 4.2 20.2a17.5 17.5 0 0 1 .2-.7 5.5 5.5 0 0 1 5.7-4.5c2.8.1 4.3 1.5 4.7 4.7.2 1.1.2 2.3.2 3.5v.4c0 2.7.7 5.2 2.2 7.4a13 13 0 0 0 5.7 4.9v-.3l-.2-.3c-1.8-5.6-.5-9.5 4.4-12.8l1.5-1a73 73 0 0 0 3.2-2.2 16 16 0 0 0 6.8-11.4c.3-2 .1-4-.6-6l-.8.6-1.6 1a37 37 0 0 1-22.4 2.7c-5-.7-9.7-2-13.2-6.2Z" /></svg>
  <h1>${opts.heading}</h1>
  <p>${opts.message}</p>
  ${selfClose}
</body>
</html>`
}

/**
 * Start a loopback listener on an EPHEMERAL 127.0.0.1 port (`listen(0)`), returning
 * the concrete `redirectUri` once bound. The 127.0.0.1-only bind is preserved — the
 * callback is never reachable off-host. Resolves the callback with both `code` and
 * `state`; strict `state` verification is done by the caller.
 */
function startCallbackServer(timeoutMs = 120_000): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let resolveCb: ((result: CallbackResult) => void) | null = null
    let rejectCb: ((err: Error) => void) | null = null
    let settled = false

    const callbackPromise = new Promise<CallbackResult>((res, rej) => {
      resolveCb = res
      rejectCb = rej
    })

    const server = createServer((req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const url = new URL(req.url, 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (error) {
        res.end(
          callbackPage({
            heading: 'Sign-in failed',
            message: 'Something went wrong. You can close this window and try again in Green Tea.'
          })
        )
        if (!settled) {
          settled = true
          rejectCb?.(new Error(`Account sign-in error: ${error}`))
        }
      } else if (code && state) {
        res.end(
          callbackPage({
            heading: 'Signed in to Green Tea',
            message: 'You can close this window and return to the app.',
            selfClose: true
          })
        )
        if (!settled) {
          settled = true
          resolveCb?.({ code, state })
        }
      } else {
        res.end(
          callbackPage({
            heading: 'Sign-in incomplete',
            message: 'No authorization code was returned. You can close this window and try again.'
          })
        )
      }
    })

    // Default 2 min (matches the worker's one-time-code expiry); callers waiting
    // on an emailed magic link pass a longer window.
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        rejectCb?.(new Error('Account sign-in timed out'))
      }
      server.close()
    }, timeoutMs)

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to start account sign-in callback server'))
        return
      }

      resolve({
        redirectUri: `http://127.0.0.1:${addr.port}/callback`,
        waitForCallback(): Promise<CallbackResult> {
          return callbackPromise
        },
        close(): void {
          clearTimeout(timeout)
          server.close()
        }
      })
    })

    server.on('error', (err) => {
      if (!settled) {
        settled = true
        rejectCb?.(err)
      }
      reject(err)
    })
  })
}

/**
 * Exchange the one-time code + PKCE verifier (and, if present, the device
 * credential) for the account bearer over a direct POST. The token only ever leaves
 * the worker over this response body — never in a redirect URL.
 */
async function exchangeCodeForToken(
  baseUrl: string,
  body: DesktopTokenRequest
): Promise<DesktopTokenResponse> {
  const res = await fetch(`${baseUrl}/auth/desktop/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    let detail = ''
    try {
      detail = JSON.stringify(await res.json())
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(`Token exchange failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }

  const data = (await res.json()) as DesktopTokenResponse
  if (!data || typeof data.token !== 'string' || !data.token || !data.user) {
    throw new Error('Token exchange returned an unexpected response')
  }
  return data
}

/**
 * Run the full Google sign-in flow: gen PKCE + state, start the ephemeral
 * loopback, open a chromeless Chrome `--app` window at the worker's
 * `/auth/desktop/google` kickoff (which sets the OAuth-state cookie and 302s to
 * Google; on return the worker mints the code and 302s to our loopback), catch
 * `/callback?code&state`, STRICT-compare `state`, exchange for a bearer, and
 * persist it. Returns a `{ success }` discriminated union so the IPC layer can
 * surface failures without throwing.
 */
export async function signIn(
  db: Database.Database
): Promise<{ success: true; user: AccountUser } | { success: false; error: string }> {
  let callbackServer: CallbackServer | null = null

  try {
    const baseUrl = resolveAccountBaseUrl()
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    const state = generateState()

    callbackServer = await startCallbackServer()

    const params = new URLSearchParams({
      redirect: callbackServer.redirectUri,
      state,
      code_challenge: codeChallenge
    })
    await openAuthWindow(`${baseUrl}/auth/desktop/google?${params.toString()}`)

    const result = await callbackServer.waitForCallback()
    callbackServer.close()
    callbackServer = null

    // CSRF/round-trip: the state returned on loopback MUST equal the one we minted.
    if (!result.state || result.state !== state) {
      return { success: false, error: 'State mismatch — sign-in was rejected for safety.' }
    }

    const device = getStoredDevice(db)
    const { token, user } = await exchangeCodeForToken(baseUrl, {
      code: result.code,
      code_verifier: codeVerifier,
      ...(device ? { device } : {})
    })

    setSecret(db, ACCOUNT_TOKEN_KEY, token)
    return { success: true, user }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Account Auth] Sign-in failed:', message)
    return { success: false, error: message }
  } finally {
    callbackServer?.close()
  }
}

/**
 * Email / magic-link sign-in. Starts the loopback, asks the worker to email a
 * sign-in link (`callbackURL` → `/auth/desktop/authorize?...`, so clicking it
 * verifies the link, sets the session, and immediately mints the code → loopback),
 * and returns as soon as the email is sent so the UI can show "check your inbox".
 * The loopback round-trip (user clicks the link → browser → loopback) is awaited
 * in the BACKGROUND; on success we exchange, persist, and call `onSignedIn` so the
 * renderer refreshes. The wait window is long (10 min) because the user has to
 * switch to their inbox.
 */
export async function sendMagicLink(
  db: Database.Database,
  email: string,
  onSignedIn: () => void
): Promise<{ success: boolean; error?: string }> {
  let callbackServer: CallbackServer | null = null
  try {
    const baseUrl = resolveAccountBaseUrl()
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    const state = generateState()

    callbackServer = await startCallbackServer(10 * 60_000)

    const params = new URLSearchParams({
      redirect: callbackServer.redirectUri,
      state,
      code_challenge: codeChallenge
    })
    const callbackURL = `${baseUrl}/auth/desktop/authorize?${params.toString()}`

    const res = await fetch(`${baseUrl}/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, callbackURL })
    })
    if (!res.ok) {
      callbackServer.close()
      return { success: false, error: `Could not send sign-in email (${res.status})` }
    }

    // Hand the server off to a background waiter; the email is already sent.
    const server = callbackServer
    callbackServer = null
    void (async () => {
      try {
        const result = await server.waitForCallback()
        if (!result.state || result.state !== state) return
        const device = getStoredDevice(db)
        const { token } = await exchangeCodeForToken(baseUrl, {
          code: result.code,
          code_verifier: codeVerifier,
          ...(device ? { device } : {})
        })
        setSecret(db, ACCOUNT_TOKEN_KEY, token)
        onSignedIn()
      } catch (err) {
        console.error('[Account Auth] Magic-link completion failed:', err)
      } finally {
        server.close()
      }
    })()

    return { success: true }
  } catch (error) {
    callbackServer?.close()
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

/**
 * Sign out. The account bearer is a revocable apiKey: we attempt an authoritative
 * server-side revoke first (best-effort — the worker's Better Auth sign-out
 * invalidates the presented key), then delete the local secret regardless. Local
 * deletion is the guaranteed outcome; a failed server revoke is surfaced so the UI
 * can warn, but never blocks local sign-out.
 */
export async function signOut(db: Database.Database): Promise<{ revoked: boolean }> {
  const token = getSecret(db, ACCOUNT_TOKEN_KEY)
  let revoked = false

  if (token) {
    try {
      const res = await fetch(`${resolveAccountBaseUrl()}/auth/desktop/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      })
      revoked = res.ok
    } catch (error) {
      console.warn('[Account Auth] Server-side sign-out revoke failed:', error)
    }
  }

  deleteSecret(db, ACCOUNT_TOKEN_KEY)
  return { revoked }
}

/**
 * Resolve the currently signed-in account, or null. Validates the stored bearer
 * (an apiKey) against the worker's dedicated `/auth/desktop/whoami` endpoint,
 * which verifies the key server-side via the apiKey plugin — deterministic, and
 * independent of Better Auth session/bearer semantics. Returns null on
 * absent/invalid token; network errors are treated as "unknown" → null so the UI
 * degrades to signed-out without crashing.
 */
export async function getAccount(db: Database.Database): Promise<AccountUser | null> {
  const token = getSecret(db, ACCOUNT_TOKEN_KEY)
  if (!token) return null

  try {
    const res = await fetch(`${resolveAccountBaseUrl()}/auth/desktop/whoami`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return null

    const data = (await res.json()) as { user?: AccountUser } | null
    if (!data || !data.user || typeof data.user.id !== 'string') return null
    return data.user
  } catch (error) {
    console.warn('[Account Auth] Failed to validate account token:', error)
    return null
  }
}
