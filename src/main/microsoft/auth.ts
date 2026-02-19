import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { createServer } from 'http'
import { randomBytes, createHash } from 'crypto'
import { shell } from 'electron'
import type {
  MicrosoftTokens,
  MicrosoftAuthData,
  MicrosoftAccountStatus,
  MicrosoftServiceType
} from './types'
import { MS_SERVICE_SCOPES } from './types'

const MS_CLIENT_ID = '82425e1a-be79-481e-a6be-ea29edf5adf6'
const MS_AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const MS_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const MS_GRAPH_ME_ENDPOINT = 'https://graph.microsoft.com/v1.0/me'

const CALLBACK_PORT = 28108
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`

function getAuthDir(): string {
  return join(homedir(), 'Documents', 'Green Tea', 'microsoft-auth')
}

function getTokenFilePath(): string {
  return join(getAuthDir(), 'tokens.json')
}

function loadAuthData(): MicrosoftAuthData {
  const filePath = getTokenFilePath()
  if (!existsSync(filePath)) return { scopes: [], enabledServices: [] }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as MicrosoftAuthData
    if (!data.enabledServices) {
      data.enabledServices = []
    }
    return data
  } catch {
    return { scopes: [], enabledServices: [] }
  }
}

function saveAuthData(data: MicrosoftAuthData): void {
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
          '<html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Microsoft Authentication Failed</h2><p>You can close this tab.</p></body></html>'
        )
        if (!settled) {
          settled = true
          codeReject?.(new Error(`Microsoft OAuth error: ${error}`))
        }
      } else if (code) {
        res.end(
          '<html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Microsoft Authentication Successful</h2><p>You can close this tab and return to Green Tea.</p></body></html>'
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
        codeReject?.(new Error('Microsoft OAuth callback timed out'))
      }
      server.close()
    }, 120_000)

    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to start Microsoft OAuth callback server'))
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

async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  scopes: string[]
): Promise<MicrosoftTokens> {
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    scope: scopes.join(' ')
  })

  const res = await fetch(MS_TOKEN_ENDPOINT, {
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

async function refreshAccessToken(
  refreshToken: string,
  scopes: string[]
): Promise<MicrosoftTokens> {
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: scopes.join(' ')
  })

  const res = await fetch(MS_TOKEN_ENDPOINT, {
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
    refresh_token?: string
    scope: string
    token_type: string
    expires_in: number
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    scope: data.scope,
    token_type: data.token_type,
    expiry_date: Date.now() + data.expires_in * 1000
  }
}

export async function authenticateMicrosoft(
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

    const state = randomBytes(16).toString('hex')

    const params = new URLSearchParams({
      client_id: MS_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: allScopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
      state
    })

    const authUrl = `${MS_AUTH_ENDPOINT}?${params.toString()}`
    console.log('[Microsoft Auth] Opening browser for authorization')
    await shell.openExternal(authUrl)

    const code = await callbackServer.waitForCode()
    callbackServer.close()
    callbackServer = null

    const tokens = await exchangeCodeForTokens(code, codeVerifier, allScopes)

    // Preserve existing refresh token if new one is empty
    const refreshToken = tokens.refresh_token || existing.tokens?.refresh_token || ''

    saveAuthData({
      tokens: { ...tokens, refresh_token: refreshToken },
      scopes: allScopes,
      enabledServices: existing.enabledServices || [],
      codeVerifier
    })

    console.log('[Microsoft Auth] Authentication successful')
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Microsoft Auth] Authentication failed:', message)
    return { success: false, error: message }
  } finally {
    callbackServer?.close()
  }
}

export async function connectMicrosoftService(
  service: MicrosoftServiceType
): Promise<{ success: boolean; error?: string }> {
  const scopes = MS_SERVICE_SCOPES[service]
  const result = await authenticateMicrosoft(scopes)
  if (result.success) {
    const data = loadAuthData()
    if (!data.enabledServices.includes(service)) {
      data.enabledServices.push(service)
      saveAuthData(data)
    }
  }
  return result
}

export function disconnectMicrosoftService(service: MicrosoftServiceType): void {
  const data = loadAuthData()
  data.enabledServices = data.enabledServices.filter((s) => s !== service)
  if (data.enabledServices.length === 0) {
    clearMicrosoftAuth()
  } else {
    saveAuthData(data)
  }
}

export function hasMicrosoftService(service: MicrosoftServiceType): boolean {
  const data = loadAuthData()
  return data.enabledServices.includes(service)
}

export function getEnabledMicrosoftServices(): MicrosoftServiceType[] {
  const data = loadAuthData()
  return data.enabledServices
}

export async function getValidMicrosoftAccessToken(): Promise<string | null> {
  const data = loadAuthData()
  if (!data.tokens) return null

  // If token expires within 5 minutes, refresh it
  const fiveMinutes = 5 * 60 * 1000
  if (data.tokens.expiry_date - Date.now() < fiveMinutes) {
    if (!data.tokens.refresh_token) return null

    try {
      const newTokens = await refreshAccessToken(data.tokens.refresh_token, data.scopes || [])
      saveAuthData({
        ...data,
        tokens: newTokens
      })
      return newTokens.access_token
    } catch (error) {
      console.error('[Microsoft Auth] Token refresh failed:', error)
      return null
    }
  }

  return data.tokens.access_token
}

export function hasMicrosoftAuth(): boolean {
  const data = loadAuthData()
  return !!data.tokens
}

export function clearMicrosoftAuth(): void {
  const filePath = getTokenFilePath()
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}

export async function getMicrosoftAccountStatus(): Promise<MicrosoftAccountStatus> {
  const data = loadAuthData()
  if (!data.tokens) {
    return { authenticated: false, scopes: [], enabledServices: [] }
  }

  const token = await getValidMicrosoftAccessToken()
  if (!token) {
    return {
      authenticated: false,
      scopes: data.scopes || [],
      enabledServices: data.enabledServices || []
    }
  }

  try {
    const res = await fetch(MS_GRAPH_ME_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (!res.ok) {
      return {
        authenticated: true,
        scopes: data.scopes || [],
        enabledServices: data.enabledServices || []
      }
    }

    const userInfo = (await res.json()) as {
      mail?: string
      userPrincipalName?: string
      displayName?: string
    }
    return {
      authenticated: true,
      email: userInfo.mail || userInfo.userPrincipalName,
      displayName: userInfo.displayName,
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
