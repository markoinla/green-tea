import type Database from 'better-sqlite3'
import { safeStorage } from 'electron'

/**
 * Encrypted, namespaced secrets store (Phase 00, §4.9).
 *
 * Secrets (OAuth refresh tokens, plugin secrets) live in their own `secrets`
 * table — never in `settings` (which `db:settings:get-all` can dump to the
 * renderer). Values are encrypted at rest with Electron `safeStorage` (key held
 * in the OS keychain: macOS Keychain / Windows DPAPI / Linux libsecret) and
 * stored as a ciphertext BLOB. The `encrypted` flag records the encoding so a
 * read knows whether to decrypt (1) or read plaintext (0).
 *
 * The service is fully synchronous (better-sqlite3 + safeStorage are both sync)
 * and takes `db` as its first argument, matching the repository convention.
 *
 * Key namespacing (enforced by callers, not here): `google`, `microsoft`,
 * `mcp:<server>`, `plugin:<pluginId>:<subKey>`.
 */

/** A stored secret row (decoded `value` to its plaintext is done by getSecret). */
interface SecretRow {
  value: Buffer | Uint8Array | null
  encrypted: number
}

let plaintextWarningLogged = false

/**
 * Whether a *secure* (device-bound) storage backend is available right now.
 *
 * Two checks, both required:
 *  - `safeStorage.isEncryptionAvailable()` — the cross-platform gate.
 *  - On Linux, `getSelectedStorageBackend()` may resolve to `basic_text`, which
 *    is plaintext-equivalent (no keyring); that is treated as NOT secure even
 *    though isEncryptionAvailable() can still report true for it.
 *
 * The device-bound guarantee only holds on macOS/Windows (and Linux with a real
 * keyring backend). Must be called after the app `ready` event.
 */
export function isSecureStorageAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
  } catch {
    return false
  }
  // getSelectedStorageBackend is Linux-only; guard for its existence and never
  // let a non-Linux throw mark storage insecure.
  try {
    if (typeof safeStorage.getSelectedStorageBackend === 'function') {
      const backend = safeStorage.getSelectedStorageBackend()
      if (backend === 'basic_text') return false
    }
  } catch {
    // Non-Linux platforms: rely on isEncryptionAvailable() above.
  }
  return true
}

function warnPlaintextOnce(): void {
  if (plaintextWarningLogged) return
  plaintextWarningLogged = true
  console.warn(
    '[Secrets] Secure storage (Electron safeStorage) is unavailable on this system. ' +
      'Secrets are being stored UNENCRYPTED (encrypted=0) as a fallback. They will be ' +
      're-encrypted automatically once a secure keychain backend becomes available.'
  )
}

/**
 * Store (or overwrite) a secret. Encrypts with safeStorage when a secure backend
 * is available; otherwise stores plaintext bytes with `encrypted=0` and logs a
 * one-time warning. `created_at` is preserved across overwrites; `updated_at`
 * advances.
 */
export function setSecret(db: Database.Database, key: string, plaintext: string): void {
  let value: Buffer
  let encrypted: number
  if (isSecureStorageAvailable()) {
    value = safeStorage.encryptString(plaintext)
    encrypted = 1
  } else {
    warnPlaintextOnce()
    value = Buffer.from(plaintext, 'utf8')
    encrypted = 0
  }
  db.prepare(
    `INSERT INTO secrets (key, value, encrypted)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       encrypted = excluded.encrypted,
       updated_at = datetime('now')`
  ).run(key, value, encrypted)
}

/**
 * Read and decrypt a secret. Returns null when the key is absent. A decrypt
 * failure (e.g. the keychain was reset, so device-bound ciphertext can no longer
 * be decrypted) is handled gracefully — it returns null rather than throwing, so
 * a caller treats it as "not authenticated" and prompts re-auth instead of
 * crashing the integration.
 */
export function getSecret(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value, encrypted FROM secrets WHERE key = ?').get(key) as
    | SecretRow
    | undefined
  if (!row || row.value == null) return null
  const buf = Buffer.isBuffer(row.value) ? row.value : Buffer.from(row.value)
  if (row.encrypted === 0) {
    return buf.toString('utf8')
  }
  try {
    return safeStorage.decryptString(buf)
  } catch (error) {
    console.warn(`[Secrets] Failed to decrypt secret "${key}"; treating as absent.`, error)
    return null
  }
}

/** Delete a secret. No-op when the key is absent. */
export function deleteSecret(db: Database.Database, key: string): void {
  db.prepare('DELETE FROM secrets WHERE key = ?').run(key)
}

/**
 * List secret keys, optionally restricted to those starting with `prefix`.
 *
 * Prefix matching is done with a wildcard-safe range scan (`key >= prefix AND
 * key < upperBound`) rather than `LIKE`, so a prefix containing SQL wildcards
 * (`%`, `_`) cannot be abused to enumerate keys outside its namespace. The upper
 * bound is the prefix with its final code unit incremented.
 */
export function listSecretKeys(db: Database.Database, prefix?: string): string[] {
  if (!prefix) {
    const rows = db.prepare('SELECT key FROM secrets ORDER BY key').all() as { key: string }[]
    return rows.map((r) => r.key)
  }
  const upper = prefixUpperBound(prefix)
  // A prefix whose last char is the max code unit has no finite upper bound; fall
  // back to a lower-bound-only scan in that (practically impossible) case.
  const rows =
    upper === null
      ? (db.prepare('SELECT key FROM secrets WHERE key >= ? ORDER BY key').all(prefix) as {
          key: string
        }[])
      : (db
          .prepare('SELECT key FROM secrets WHERE key >= ? AND key < ? ORDER BY key')
          .all(prefix, upper) as { key: string }[])
  return rows.map((r) => r.key)
}

/**
 * Smallest string strictly greater than every string that starts with `prefix`,
 * produced by incrementing the final code unit. Returns null when no such bound
 * exists (final char is the max code unit).
 */
function prefixUpperBound(prefix: string): string | null {
  const last = prefix.charCodeAt(prefix.length - 1)
  if (last === 0xffff) return null
  return prefix.slice(0, -1) + String.fromCharCode(last + 1)
}

/**
 * Upgrade any plaintext-fallback rows (`encrypted=0`) to encrypted storage once a
 * secure backend is available. Idempotent and safe to call on every startup
 * after app `ready`; a no-op when storage is insecure or no plaintext rows
 * remain. Returns the number of rows upgraded.
 */
export function reEncryptPlaintextSecrets(db: Database.Database): number {
  if (!isSecureStorageAvailable()) return 0
  const rows = db.prepare('SELECT key, value FROM secrets WHERE encrypted = 0').all() as {
    key: string
    value: Buffer | Uint8Array | null
  }[]
  if (rows.length === 0) return 0
  const update = db.prepare(
    `UPDATE secrets SET value = ?, encrypted = 1, updated_at = datetime('now') WHERE key = ?`
  )
  let upgraded = 0
  const run = db.transaction(() => {
    for (const row of rows) {
      if (row.value == null) continue
      const buf = Buffer.isBuffer(row.value) ? row.value : Buffer.from(row.value)
      const plaintext = buf.toString('utf8')
      update.run(safeStorage.encryptString(plaintext), row.key)
      upgraded++
    }
  })
  run()
  return upgraded
}
