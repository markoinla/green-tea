import { createHash } from 'crypto'

/**
 * Self-write registry: lets the vault watcher tell the app's own atomic writes
 * apart from genuine external edits, so it never echo-loops on its own saves.
 *
 * Zero-import leaf module (only `crypto`). It must never import note-store,
 * documents-service, or vault-watcher — that keeps the dependency graph a DAG
 * (self-write.ts ← note-store.ts ← documents-service.ts ← vault-watcher.ts).
 *
 * The guard is CONTENT-HASH keyed, not timer keyed: a hash match wins at any
 * age, so it survives arbitrary filesystem-event latency. The TTL only bounds
 * how long a never-observed entry lingers in memory.
 */

interface SelfWriteEntry {
  hash: string
  expiry: number
}

const TTL_MS = 5000
const registry = new Map<string, SelfWriteEntry>()

function normKey(absPath: string): string {
  return absPath.normalize('NFC')
}

export function hashContent(contents: string): string {
  return createHash('sha1').update(contents).digest('hex')
}

/** Called by note-store.writeNote with the FINAL file path and serialized bytes. */
export function markSelfWrite(absPath: string, contents: string): void {
  registry.set(normKey(absPath), { hash: hashContent(contents), expiry: Date.now() + TTL_MS })
}

/**
 * Returns true (and CONSUMES the entry) if absPath has a pending self-write whose
 * content hash matches `currentContents`. Timing-independent: a hash match wins
 * at any age. A stale entry (expired AND hash mismatch) is dropped lazily.
 */
export function consumeSelfWrite(absPath: string, currentContents: string): boolean {
  const key = normKey(absPath)
  const entry = registry.get(key)
  if (!entry) return false
  if (entry.hash === hashContent(currentContents)) {
    registry.delete(key)
    return true
  }
  // Stale and content diverged → a real external edit happened after our write.
  if (Date.now() > entry.expiry) registry.delete(key)
  return false
}

/** Test/lifecycle helper. */
export function clearSelfWriteRegistry(): void {
  registry.clear()
}
