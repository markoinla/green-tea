import type Database from 'better-sqlite3'
import { AuthStorage, type AuthStorageBackend } from '@earendil-works/pi-coding-agent'
import { getDatabase } from '../database/connection'
import { getSecret, setSecret } from '../secrets'

/**
 * pi's {@link AuthStorage} (used to resolve provider credentials when building an
 * agent session) is normally file-backed at `~/.pi/agent/auth.json`. We instead
 * back the entire pi auth blob with Green Tea's encrypted secrets store (Phase
 * 00, §4.9) so OAuth refresh/access tokens for connected Claude / ChatGPT
 * accounts are encrypted at rest in the OS keychain like every other secret —
 * never written to a plaintext dotfile.
 *
 * The blob is a single JSON string keyed by pi provider id (e.g. `anthropic`,
 * `openai-codex`). pi owns its shape, token refresh, and request-header
 * injection; this backend only loads/persists the opaque string under one
 * secret key.
 */
const PI_AUTH_SECRET_KEY = 'pi-auth'

type LockResult<T> = { result: T; next?: string }

class SecretBackedAuthStorageBackend implements AuthStorageBackend {
  constructor(private readonly db: Database.Database) {}

  withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
    const current = getSecret(this.db, PI_AUTH_SECRET_KEY) ?? undefined
    const { result, next } = fn(current)
    if (next !== undefined) {
      setSecret(this.db, PI_AUTH_SECRET_KEY, next)
    }
    return result
  }

  async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
    const current = getSecret(this.db, PI_AUTH_SECRET_KEY) ?? undefined
    const { result, next } = await fn(current)
    if (next !== undefined) {
      setSecret(this.db, PI_AUTH_SECRET_KEY, next)
    }
    return result
  }
}

/**
 * Build an {@link AuthStorage} whose persistent credentials live in the encrypted
 * secrets store. Runtime API keys set via `setRuntimeApiKey` (the path used for
 * the Together/OpenRouter/Zenlayer/Anthropic-key providers) stay in-memory and
 * are unaffected by the backend.
 */
export function getPiAuthStorage(db: Database.Database = getDatabase()): AuthStorage {
  return AuthStorage.fromStorage(new SecretBackedAuthStorageBackend(db))
}
