import { shell } from 'electron'
import type {
  OAuthAuthInfo,
  OAuthLoginCallbacks,
  OAuthSelectPrompt
} from '@earendil-works/pi-ai/compat'
import { getPiAuthStorage } from './secret-backend'

export { getPiAuthStorage } from './secret-backend'

/**
 * LLM subscription accounts a user can connect via OAuth — surfaced in
 * Settings → Accounts alongside Google / Microsoft. The ids are pi's own
 * provider ids, so the stored credential is resolved automatically when the
 * matching `aiProvider` (`anthropic-oauth` / `openai-codex`) is selected. pi
 * handles token refresh and request-header injection (Anthropic OAuth beta +
 * Claude Code identity, Codex `chatgpt-account-id` decoded from the token).
 */
export const LLM_OAUTH_PROVIDERS = [
  { id: 'anthropic', name: 'Claude (Pro / Max)' },
  { id: 'openai-codex', name: 'ChatGPT (Codex)' }
] as const

export type LlmOAuthProviderId = (typeof LLM_OAUTH_PROVIDERS)[number]['id']

export type LlmAccountStatus = Record<LlmOAuthProviderId, { connected: boolean }>

function isKnownProvider(id: string): id is LlmOAuthProviderId {
  return LLM_OAUTH_PROVIDERS.some((p) => p.id === id)
}

/**
 * Login callbacks for the desktop flow. The OAuth providers run a localhost
 * callback server and open the system browser, so no in-app prompt UI is
 * needed: the browser redirect is captured automatically.
 */
function desktopLoginCallbacks(): OAuthLoginCallbacks {
  return {
    onAuth: (info: OAuthAuthInfo) => {
      void shell.openExternal(info.url)
    },
    // Codex offers browser vs. device-code; always take browser on desktop.
    onSelect: async (prompt: OAuthSelectPrompt) => {
      const browser = prompt.options.find((o) => o.id.includes('browser'))
      return (browser ?? prompt.options[0])?.id
    },
    // Device-code path is never selected above; required by the interface.
    onDeviceCode: () => {},
    // Only reached if the localhost callback server can't bind (port in use).
    onPrompt: async () => {
      throw new Error(
        'Automatic login could not complete. The local callback port may be in use — close other coding-agent logins and try again.'
      )
    }
  }
}

/**
 * Run the OAuth login flow for an LLM subscription provider and persist the
 * resulting credentials to the encrypted secrets store. Opens the system
 * browser; resolves when the browser redirect is captured.
 */
export async function connectLlmProvider(
  providerId: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (!isKnownProvider(providerId)) {
    return { success: false, error: `Unknown provider: ${providerId}` }
  }
  try {
    const authStorage = getPiAuthStorage()
    await authStorage.login(providerId, desktopLoginCallbacks())
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[LLM Auth] Login failed for "${providerId}":`, message)
    return { success: false, error: message }
  }
}

/** Remove stored credentials for an LLM subscription provider. */
export function disconnectLlmProvider(providerId: string): void {
  if (!isKnownProvider(providerId)) return
  getPiAuthStorage().logout(providerId)
}

/** Whether OAuth credentials are stored for the given provider. */
export function isLlmProviderConnected(providerId: LlmOAuthProviderId): boolean {
  return getPiAuthStorage().get(providerId)?.type === 'oauth'
}

/** Connection status for every connectable LLM account. */
export function getLlmAccountStatus(): LlmAccountStatus {
  const authStorage = getPiAuthStorage()
  const status = {} as LlmAccountStatus
  for (const { id } of LLM_OAUTH_PROVIDERS) {
    status[id] = { connected: authStorage.get(id)?.type === 'oauth' }
  }
  return status
}
