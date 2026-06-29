import type Database from 'better-sqlite3'
import { existsSync, readFileSync, readdirSync, unlinkSync, rmdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getSecret, setSecret, deleteSecret, isSecureStorageAvailable } from './index'

/**
 * One-time, idempotent, NON-DESTRUCTIVE migration of the three legacy plaintext
 * OAuth stores into the encrypted secrets store (Phase 00, §4.9 / §6).
 *
 *   ~/Documents/Green Tea/google-auth/tokens.json     -> secret `google`
 *   ~/Documents/Green Tea/microsoft-auth/tokens.json  -> secret `microsoft`
 *   ~/Documents/Green Tea/mcp-auth/<server>.json      -> secret `mcp:<server>`
 *
 * The COMPLETE auth object is migrated per store (tokens + scopes/clientInfo +
 * codeVerifier + …), serialized verbatim as JSON — not just the tokens.
 *
 * Two decoupled invariants, each independently self-healing on every startup:
 *
 *  1. **ensure-secret-present** — migrate a file only when its key is ABSENT from
 *     the store (strict per-key idempotency; there is deliberately NO global
 *     `secrets_migrated` flag). Order is strict: encrypt -> store (committed) ->
 *     read-back -> deep-equality compare (asserting `refresh_token` when present).
 *     A corrupt round-trip deletes the just-written secret and leaves the file.
 *
 *  2. **ensure-source-absent** — on EVERY startup, if a securely-encrypted secret
 *     exists AND its legacy plaintext file still exists AND the decrypted secret
 *     deep-equals the file, (re)attempt unlink; then rmdir each `*-auth/` dir once
 *     empty. This runs independently of whether anything migrated this run, so a
 *     crash between store and unlink heals on the next launch.
 *
 * Plaintext-fallback safety: when no secure backend is available
 * (`safeStorage` unavailable, or Linux `basic_text`), the secret is STILL written
 * (so integrations read from the store, and {@link reEncryptPlaintextSecrets}
 * upgrades it later) but the plaintext files are LEFT IN PLACE — never
 * migrate-and-delete without device-bound encryption. The unlink retries on a
 * later startup once a secure backend is available and the row is encrypted.
 *
 * `encryptString` is non-deterministic, so verification never compares ciphertext
 * — it always decrypts, JSON-parses, and deep-compares against the parsed source.
 */

interface LegacyItem {
  key: string
  file: string
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (typeof a !== 'object') return false
  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aArr || bArr) {
    if (!aArr || !bArr || a.length !== b.length) return false
    return (a as unknown[]).every((v, i) => deepEqual(v, (b as unknown[])[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  const bk = Object.keys(bo)
  if (ak.length !== bk.length) return false
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]))
}

/** The `tokens.refresh_token` of an auth object, when present as a string. */
function refreshTokenOf(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const tokens = (obj as { tokens?: unknown }).tokens
  if (!tokens || typeof tokens !== 'object') return undefined
  const rt = (tokens as { refresh_token?: unknown }).refresh_token
  return typeof rt === 'string' ? rt : undefined
}

/**
 * Verify the stored secret round-trips to a deep-equal copy of `source`. Decrypts
 * (never compares ciphertext), JSON-parses, deep-compares, and — when the source
 * carries a `refresh_token` — explicitly asserts it survived present and equal.
 */
function verifyRoundTrip(db: Database.Database, key: string, source: unknown): boolean {
  const stored = getSecret(db, key)
  if (stored === null) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return false
  }
  if (!deepEqual(parsed, source)) return false
  const srcRt = refreshTokenOf(source)
  if (srcRt !== undefined && refreshTokenOf(parsed) !== srcRt) return false
  return true
}

function rowExists(db: Database.Database, key: string): boolean {
  return db.prepare('SELECT 1 FROM secrets WHERE key = ?').get(key) !== undefined
}

function rowIsEncrypted(db: Database.Database, key: string): boolean {
  const row = db.prepare('SELECT encrypted FROM secrets WHERE key = ?').get(key) as
    | { encrypted: number }
    | undefined
  return row?.encrypted === 1
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

/** Enumerate the legacy files that still exist under `baseDir`. */
function collectItems(baseDir: string): { items: LegacyItem[]; authDirs: string[] } {
  const googleDir = join(baseDir, 'google-auth')
  const microsoftDir = join(baseDir, 'microsoft-auth')
  const mcpDir = join(baseDir, 'mcp-auth')
  const items: LegacyItem[] = []

  const googleFile = join(googleDir, 'tokens.json')
  if (existsSync(googleFile)) items.push({ key: 'google', file: googleFile })

  const microsoftFile = join(microsoftDir, 'tokens.json')
  if (existsSync(microsoftFile)) items.push({ key: 'microsoft', file: microsoftFile })

  // Enumerate mcp-auth/*.json by FILENAME (reusing the legacy sanitization) rather
  // than the current config, so orphaned-but-valid token files migrate too.
  if (existsSync(mcpDir)) {
    let entries: string[] = []
    try {
      entries = readdirSync(mcpDir)
    } catch {
      entries = []
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      const server = name.slice(0, -'.json'.length)
      const safe = server.replace(/[^a-zA-Z0-9_-]/g, '_')
      items.push({ key: `mcp:${safe}`, file: join(mcpDir, name) })
    }
  }

  return { items, authDirs: [googleDir, microsoftDir, mcpDir] }
}

/** Remove a `*-auth/` dir only when it holds nothing but OS junk (e.g. `.DS_Store`). */
function rmdirIfEmpty(dir: string): void {
  if (!existsSync(dir)) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  const meaningful = entries.filter((e) => e !== '.DS_Store')
  if (meaningful.length > 0) return
  try {
    for (const e of entries) unlinkSync(join(dir, e))
    rmdirSync(dir)
    console.log(`[secrets] removed empty legacy auth dir ${dir}`)
  } catch (err) {
    console.error(`[secrets] failed to remove legacy auth dir ${dir}`, err)
  }
}

/**
 * Run the OAuth secrets migration against `baseDir` (defaults to the hardcoded
 * legacy location the three auth modules wrote to). Safe to call on every startup
 * — fully idempotent and non-destructive. Callers should still wrap it in
 * try/catch so a filesystem error degrades to "not yet migrated".
 */
export function migrateOAuthSecrets(
  db: Database.Database,
  baseDir: string = join(homedir(), 'Documents', 'Green Tea')
): void {
  const { items, authDirs } = collectItems(baseDir)
  const secure = isSecureStorageAvailable()

  for (const item of items) {
    // --- Invariant 1: ensure-secret-present (only when the key is absent) -----
    if (!rowExists(db, item.key)) {
      const source = readJsonFile(item.file)
      if (source === null) {
        console.warn(`[secrets] legacy auth file unreadable/invalid; skipping: ${item.file}`)
      } else {
        setSecret(db, item.key, JSON.stringify(source))
        if (verifyRoundTrip(db, item.key, source)) {
          console.log(`[secrets] migrated "${item.key}" into the encrypted secrets store`)
        } else {
          // Never leave a corrupt secret a future startup would skip over.
          deleteSecret(db, item.key)
          console.error(
            `[secrets] round-trip verify FAILED for "${item.key}"; left plaintext file in place`
          )
        }
      }
    }

    // --- Invariant 2: ensure-source-absent (self-healing, secure-only) -------
    // Only unlink when storage is genuinely secure AND the stored secret is
    // encrypted (encrypted=1) AND it verifies against the file on disk.
    if (secure && existsSync(item.file) && rowIsEncrypted(db, item.key)) {
      const source = readJsonFile(item.file)
      if (source !== null && verifyRoundTrip(db, item.key, source)) {
        try {
          unlinkSync(item.file)
          console.log(`[secrets] removed migrated plaintext source ${item.file}`)
        } catch (err) {
          console.error(`[secrets] failed to unlink ${item.file}`, err)
        }
      }
    }
  }

  if (!secure && items.length > 0) {
    console.warn(
      '[secrets] secure storage unavailable: migrated OAuth tokens into the store but LEFT the ' +
        'plaintext *-auth files intact. The plaintext files will be removed on a later startup ' +
        'once a secure keychain backend is available.'
    )
  }

  // Reclaim the now-empty legacy dirs (only when truly empty).
  for (const dir of authDirs) rmdirIfEmpty(dir)
}
