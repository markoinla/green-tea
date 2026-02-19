import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { createServer } from 'http'
import { shell } from 'electron'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'

interface AuthData {
  tokens?: OAuthTokens
  clientInfo?: OAuthClientInformationMixed
  codeVerifier?: string
}

function getAuthDir(): string {
  return join(homedir(), 'Documents', 'Green Tea', 'mcp-auth')
}

function getAuthFilePath(serverName: string): string {
  const safe = serverName.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(getAuthDir(), `${safe}.json`)
}

function loadAuthData(serverName: string): AuthData {
  const filePath = getAuthFilePath(serverName)
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

function saveAuthData(serverName: string, data: AuthData): void {
  const filePath = getAuthFilePath(serverName)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

export function hasAuthData(serverName: string): boolean {
  const data = loadAuthData(serverName)
  return !!data.tokens
}

export function clearAuthData(serverName: string): void {
  const filePath = getAuthFilePath(serverName)
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}

export function createElectronOAuthProvider(
  serverName: string,
  redirectUrl: string
): OAuthClientProvider {
  return {
    get redirectUrl() {
      return redirectUrl
    },

    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: 'Green Tea',
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      }
    },

    clientInformation(): OAuthClientInformationMixed | undefined {
      return loadAuthData(serverName).clientInfo
    },

    saveClientInformation(clientInfo: OAuthClientInformationMixed): void {
      const data = loadAuthData(serverName)
      data.clientInfo = clientInfo
      saveAuthData(serverName, data)
    },

    tokens(): OAuthTokens | undefined {
      return loadAuthData(serverName).tokens
    },

    saveTokens(tokens: OAuthTokens): void {
      const data = loadAuthData(serverName)
      data.tokens = tokens
      saveAuthData(serverName, data)
    },

    async redirectToAuthorization(url: URL): Promise<void> {
      console.log('[MCP OAuth] Opening browser for authorization:', url.toString())
      await shell.openExternal(url.toString())
    },

    saveCodeVerifier(codeVerifier: string): void {
      const data = loadAuthData(serverName)
      data.codeVerifier = codeVerifier
      saveAuthData(serverName, data)
    },

    codeVerifier(): string {
      return loadAuthData(serverName).codeVerifier || ''
    }
  }
}

export const OAUTH_CALLBACK_PORT = 28106
export const OAUTH_REDIRECT_URL = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`

interface CallbackServer {
  port: number
  waitForCode(): Promise<string>
  close(): void
}

export function startOAuthCallbackServer(): Promise<CallbackServer> {
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

      const url = new URL(req.url, `http://127.0.0.1`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      if (error) {
        res.end(
          '<html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Authentication Failed</h2><p>You can close this tab.</p></body></html>'
        )
        if (!settled) {
          settled = true
          codeReject?.(new Error(`OAuth error: ${error}`))
        }
      } else if (code) {
        res.end(
          '<html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Authentication Successful</h2><p>You can close this tab and return to Green Tea.</p></body></html>'
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
        codeReject?.(new Error('OAuth callback timed out'))
      }
      server.close()
    }, 120_000)

    server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to start callback server'))
        return
      }

      resolve({
        port: addr.port,
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
