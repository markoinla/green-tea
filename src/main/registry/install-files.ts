import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import type { RegistryItemType } from '../../shared/share-contract'

/**
 * Shared validation + on-disk plumbing for community-registry installs.
 *
 * Registry item ids are `<handle>/<slug>`. Both halves match restricted,
 * slash-free regexes (mirrored server-side), so an id can always be parsed and
 * recomposed unambiguously. On disk, registry items are namespaced as
 * `<handle>--<slug>` so `alice/pdf-tools` and `bob/pdf-tools` never collide in
 * the same plugins/skills directory, and a squatter can't hijack another
 * publisher's local install slot.
 *
 * Every file path returned by the registry is treated as HOSTILE until proven
 * otherwise: the server validates paths at publish time, but the client is the
 * actual disk-write surface, so it re-validates independently (defense in
 * depth) — absolute paths, `..`/`.`/empty segments, backslashes, drive
 * letters, control chars, over-long paths, and a final resolved-containment
 * check before any byte hits disk.
 */

/** Publisher handle shape (server-side source of truth: publisher_handles.handle). */
export const HANDLE_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/

/** Item slug shape — the existing plugin id regex, reused verbatim. */
export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Strict release-only semver: no prerelease, no build metadata, no leading zeros. */
export const VERSION_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** Handles that would enable impersonation — rejected client-side before publish. */
export const RESERVED_HANDLES = new Set([
  'greentea',
  'green-tea',
  'official',
  'admin',
  'support',
  'security',
  'marko',
  'registry',
  'api',
  'auth'
])

/** Provenance marker written inside every registry-installed item dir. */
export const REGISTRY_MARKER_FILENAME = '.registry.json'

export interface RegistryProvenance {
  /** Registry item id, `<handle>/<slug>`. Update checks match on THIS, never the bare slug. */
  itemId: string
  /**
   * The item's registry type. Consumers must correlate provenance to installed
   * items on type + slug, never slug alone (a plugin's slug can coincide with a
   * skill's name). Optional only because markers written before this field
   * existed lack it — readers fall back to the containing directory (plugins
   * dir vs skills dir), which determines the type unambiguously.
   */
  type?: RegistryItemType
  /** The installed version (strict release semver). */
  version: string
  /** ISO 8601 install instant. */
  installedAt: string
}

/** Parse and validate a registry item id (`<handle>/<slug>`). Throws on any deviation. */
export function parseRegistryItemId(itemId: string): { handle: string; slug: string } {
  if (typeof itemId !== 'string') throw new Error('Invalid registry item id')
  const slash = itemId.indexOf('/')
  if (slash < 0 || itemId.indexOf('/', slash + 1) !== -1) {
    throw new Error(`Invalid registry item id "${itemId}" (expected "<handle>/<slug>")`)
  }
  const handle = itemId.slice(0, slash)
  const slug = itemId.slice(slash + 1)
  if (!HANDLE_REGEX.test(handle)) {
    throw new Error(`Invalid registry handle "${handle}"`)
  }
  if (!SLUG_REGEX.test(slug)) {
    throw new Error(`Invalid registry slug "${slug}"`)
  }
  return { handle, slug }
}

/**
 * The on-disk directory (and, for plugins, the rewritten manifest id) for a
 * registry item: `<handle>--<slug>`. Both halves match `[a-z0-9-]`, so the
 * result stays inside the plugin id charset; total length must fit the
 * 64-char id regex (enforced server-side as handle+slug ≤ 62, re-checked here).
 */
export function registryDirName(itemId: string): string {
  const { handle, slug } = parseRegistryItemId(itemId)
  const dirName = `${handle}--${slug}`
  if (!SLUG_REGEX.test(dirName)) {
    throw new Error(`Registry item "${itemId}" produces an invalid install directory name`)
  }
  return dirName
}

/**
 * Validate a registry-relative file path before it is used for a download URL
 * or a disk write. Rejects (throws) rather than normalizes — a hostile path is
 * evidence of a compromised response, not something to fix up.
 */
export function validateRegistryFilePath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('Registry file path must be a non-empty string')
  }
  if (path.length > 256) {
    throw new Error(`Registry file path is too long (${path.length} > 256)`)
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error('Registry file path contains control characters')
  }
  if (path.includes('\\')) {
    throw new Error(`Registry file path "${path}" contains backslashes`)
  }
  if (path.startsWith('/')) {
    throw new Error(`Registry file path "${path}" is absolute`)
  }
  if (/^[a-zA-Z]:/.test(path)) {
    throw new Error(`Registry file path "${path}" has a drive-letter prefix`)
  }
  const segments = path.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`Registry file path "${path}" contains empty, "." or ".." segments`)
  }
  return path
}

/**
 * Write one downloaded file under `itemDir`, re-validating the relative path
 * and requiring the RESOLVED destination to stay inside `itemDir` — never
 * trust the server response for disk writes.
 */
export function writeRegistryFile(itemDir: string, relPath: string, content: Buffer): void {
  validateRegistryFilePath(relPath)
  const root = resolve(itemDir)
  const dest = resolve(join(itemDir, relPath))
  if (!dest.startsWith(root + sep)) {
    throw new Error(`Registry file path "${relPath}" escapes the install directory`)
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, content)
}

/** Persist the provenance marker inside an installed item dir. */
export function writeRegistryProvenance(itemDir: string, provenance: RegistryProvenance): void {
  writeFileSync(join(itemDir, REGISTRY_MARKER_FILENAME), JSON.stringify(provenance, null, 2) + '\n')
}

/**
 * Read the provenance marker from an installed item dir, or null when the item
 * is not registry-sourced (or the marker is unreadable/malformed).
 */
export function readRegistryProvenance(itemDir: string): RegistryProvenance | null {
  const markerPath = join(itemDir, REGISTRY_MARKER_FILENAME)
  if (!existsSync(markerPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf-8')) as RegistryProvenance
    if (
      !parsed ||
      typeof parsed.itemId !== 'string' ||
      typeof parsed.version !== 'string' ||
      !VERSION_REGEX.test(parsed.version)
    ) {
      return null
    }
    parseRegistryItemId(parsed.itemId)
    // An unrecognized `type` is dropped rather than failing the whole marker:
    // itemId/version are still trustworthy, and callers already handle the
    // legacy no-type case by inferring from the containing directory.
    if (parsed.type !== 'skill' && parsed.type !== 'plugin') {
      delete parsed.type
    }
    return parsed
  } catch {
    return null
  }
}
