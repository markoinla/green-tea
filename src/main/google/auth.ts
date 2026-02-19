import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { createServer } from 'http'
import { randomBytes, createHash } from 'crypto'
import { shell } from 'electron'
import type { GoogleTokens, GoogleAuthData, GoogleAccountStatus, GoogleServiceType } from './types'
import { GOOGLE_SCOPES, SERVICE_SCOPES } from './types'

const GOOGLE_CLIENT_ID = '682092462847-656ukmupfve62gqasltc7f3nlbhinqu3.apps.googleusercontent.com'
const GOOGLE_CLIENT_SECRET = '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'
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'

const CALLBACK_PORT = 28107
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`

function getAuthDir(): string {
  return join(homedir(), 'Documents', 'Green Tea', 'google-auth')
}

function getTokenFilePath(): string {
  return join(getAuthDir(), 'tokens.json')
}

function loadAuthData(): GoogleAuthData {
  const filePath = getTokenFilePath()
  if (!existsSync(filePath)) return { scopes: [], enabledServices: [] }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as GoogleAuthData
    // Backward compat: if existing auth has no enabledServices but has tokens with calendar scope
    if (!data.enabledServices) {
      data.enabledServices = []
      if (data.tokens && data.scopes?.includes(GOOGLE_SCOPES.CALENDAR_READONLY)) {
        data.enabledServices = ['calendar']
      }
    }
    return data
  } catch {
    return { scopes: [], enabledServices: [] }
  }
}

function saveAuthData(data: GoogleAuthData): void {
  const filePath = getTokenFilePath()
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

interface CallbackServer {
  waitForCode(): Promise<string>
  close(): void
}

function startCallbackServer(): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let codeResolve: ((code: string) => void) | null = null
    let codeReject: ((err: Error) => void) | null = null
    let settled = false

    const codePromise = new Promise<string>((res, rej) => {
      codeResolve = res
      codeReject = rej
    })

    const server = createServer((req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const url = new URL(req.url, 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      if (error) {
        res.end(
          '<html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Google Authentication Failed</h2><p>You can close this tab.</p></body></html>'
        )
        if (!settled) {
          settled = true
          codeReject?.(new Error(`Google OAuth error: ${error}`))
        }
      } else if (code) {
        res.end(
          '<html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Google Authentication Successful</h2><p>You can close this tab and return to Green Tea.</p></body></html>'
        )
        if (!settled) {
          settled = true
          codeResolve?.(code)
        }
      } else {
        res.end(
          '<html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Missing authorization code</h2></body></html>'
        )
      }
    })

    // 2-minute timeout
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        codeReject?.(new Error('Google OAuth callback timed out'))
      }
      server.close()
    }, 120_000)

    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to start Google OAuth callback server'))
        return
      }

      resolve({
        waitForCode(): Promise<string> {
          return codePromise
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
        codeReject?.(err)
      }
      reject(err)
    })
  })
}

async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI
  })

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    scope: string
    token_type: string
    expires_in: number
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    scope: data.scope,
    token_type: data.token_type,
    expiry_date: Date.now() + data.expires_in * 1000
  }
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as {
    access_token: string
    scope: string
    token_type: string
    expires_in: number
  }

  return {
    access_token: data.access_token,
    refresh_token: refreshToken,
    scope: data.scope,
    token_type: data.token_type,
    expiry_date: Date.now() + data.expires_in * 1000
  }
}

export async function authenticateGoogle(
  scopes: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  let callbackServer: CallbackServer | null = null

  try {
    callbackServer = await startCallbackServer()

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)

    // Merge requested scopes with existing scopes for incremental auth
    const existing = loadAuthData()
    const allScopes = [...new Set([...(existing.scopes || []), ...scopes])]

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: allScopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true'
    })

    const authUrl = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`
    console.log('[Google Auth] Opening browser for authorization')
    await shell.openExternal(authUrl)

    const code = await callbackServer.waitForCode()
    callbackServer.close()
    callbackServer = null

    const tokens = await exchangeCodeForTokens(code, codeVerifier)

    // Preserve existing refresh token if new one is empty
    const refreshToken = tokens.refresh_token || existing.tokens?.refresh_token || ''

    saveAuthData({
      tokens: { ...tokens, refresh_token: refreshToken },
      scopes: allScopes,
      enabledServices: existing.enabledServices || [],
      codeVerifier
    })

    console.log('[Google Auth] Authentication successful')
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Google Auth] Authentication failed:', message)
    return { success: false, error: message }
  } finally {
    callbackServer?.close()
  }
}

export async function connectGoogleService(
  service: GoogleServiceType
): Promise<{ success: boolean; error?: string }> {
  const scopes = SERVICE_SCOPES[service]
  const result = await authenticateGoogle(scopes)
  if (result.success) {
    const data = loadAuthData()
    if (!data.enabledServices.includes(service)) {
      data.enabledServices.push(service)
      saveAuthData(data)
    }
  }
  return result
}

export function disconnectGoogleService(service: GoogleServiceType): void {
  const data = loadAuthData()
  data.enabledServices = data.enabledServices.filter((s) => s !== service)
  if (data.enabledServices.length === 0) {
    clearGoogleAuth()
  } else {
    saveAuthData(data)
  }
}

export function hasGoogleService(service: GoogleServiceType): boolean {
  const data = loadAuthData()
  return data.enabledServices.includes(service)
}

export function getEnabledServices(): GoogleServiceType[] {
  const data = loadAuthData()
  return data.enabledServices
}

export async function getValidAccessToken(): Promise<string | null> {
  const data = loadAuthData()
  if (!data.tokens) return null

  // If token expires within 5 minutes, refresh it
  const fiveMinutes = 5 * 60 * 1000
  if (data.tokens.expiry_date - Date.now() < fiveMinutes) {
    if (!data.tokens.refresh_token) return null

    try {
      const newTokens = await refreshAccessToken(data.tokens.refresh_token)
      saveAuthData({
        ...data,
        tokens: newTokens
      })
      return newTokens.access_token
    } catch (error) {
      console.error('[Google Auth] Token refresh failed:', error)
      return null
    }
  }

  return data.tokens.access_token
}

export function hasGoogleAuth(): boolean {
  const data = loadAuthData()
  return !!data.tokens
}

export function clearGoogleAuth(): void {
  const filePath = getTokenFilePath()
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}

export async function getAccountStatus(): Promise<GoogleAccountStatus> {
  const data = loadAuthData()
  if (!data.tokens) {
    return { authenticated: false, scopes: [], enabledServices: [] }
  }

  const token = await getValidAccessToken()
  if (!token) {
    return {
      authenticated: false,
      scopes: data.scopes || [],
      enabledServices: data.enabledServices || []
    }
  }

  try {
    const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (!res.ok) {
      return {
        authenticated: true,
        scopes: data.scopes || [],
        enabledServices: data.enabledServices || []
      }
    }

    const userInfo = (await res.json()) as { email?: string }
    return {
      authenticated: true,
      email: userInfo.email,
      scopes: data.scopes || [],
      enabledServices: data.enabledServices || []
    }
  } catch {
    return {
      authenticated: true,
      scopes: data.scopes || [],
      enabledServices: data.enabledServices || []
    }
  }
}
