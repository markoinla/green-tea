// Note-metadata derivation rules (PLAN §4.2 / §4.4).
//
// Files stay just-frontmatter; everything here turns a parsed frontmatter object
// into the rows of the derived EAV index (`document_properties`) and supplies the
// shared type-inference + case-folding helpers used by the indexer, query, filter
// and tag-suggest paths. Defined once so query identity is deterministic.

/**
 * Keys owned by the app's identity/timestamp layer. The indexer never derives
 * rows for them, the renderer hides `id` and renders the rest read-only, and the
 * write chokepoint rejects them. Defined once and reused everywhere.
 */
export const RESERVED_KEYS = new Set(['id', 'title', 'created', 'updated'])

export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'tags'

export interface DerivedProperty {
  key: string
  value: string
  value_fold: string
  value_type: PropertyType
  conforms: number
}

/**
 * Case-fold + Unicode-normalize a value for match/group. NFC then lowercase.
 * `toLowerCase()` is locale-invariant in JS (no Turkish-I hazard). The same
 * fold is reused by indexer, query, filter and tag-suggest.
 */
export function fold(value: string): string {
  return String(value).normalize('NFC').toLowerCase()
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** Does a scalar look like an ISO-ish date (date or date-time)? */
function looksLikeDate(value: unknown): boolean {
  return typeof value === 'string' && ISO_DATE_RE.test(value.trim())
}

/**
 * Seed type for a freshly-seen property name from its value (§4.3). Used only
 * when there is no `property_types` row yet; the user override is authoritative.
 */
export function inferType(value: unknown): PropertyType {
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  if (looksLikeDate(value)) return 'date'
  return 'text'
}

/** Does a coerced TEXT value parse as the given registry type? (conforms gate) */
export function conformsToType(value: string, type: PropertyType): boolean {
  switch (type) {
    case 'number':
      return value.trim() !== '' && !Number.isNaN(Number(value))
    case 'checkbox': {
      const f = value.trim().toLowerCase()
      return f === 'true' || f === 'false'
    }
    case 'date':
      return looksLikeDate(value)
    // text / list / tags: any non-empty string conforms.
    case 'text':
    case 'list':
    case 'tags':
    default:
      return true
  }
}

/** Is this a scalar we can coerce to a TEXT leaf? */
function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  )
}

/** Coerce a scalar leaf to its TEXT form, or null when it produces no row. */
function coerceScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (!isScalar(value)) return null
  const s = String(value)
  if (s.length === 0) return null
  return s
}

/** Strip a single leading `#` from a tag (§4.4) so `#research` == `research`. */
function stripTagHash(value: string): string {
  return value.startsWith('#') ? value.slice(1) : value
}

/**
 * Derive the `document_properties` rows from a parsed frontmatter object,
 * applying the §4.2 coercion rules and §4.4 tag canonicalization. RESERVED_KEYS
 * are skipped. `typeFor` resolves the registry type for a key (defaults to the
 * inferred type when the registry has no row yet).
 *
 * Coercion: scalars via String(); null/empty -> no row; nested objects and
 * arrays-of-objects are skipped (not indexed); one row per list/tags element.
 * Tags: alias singular `tag` -> `tags`, strip a single leading `#` per element.
 */
export function deriveProperties(
  fm: Record<string, unknown>,
  typeFor?: (key: string, inferred: PropertyType) => PropertyType
): DerivedProperty[] {
  const rows: DerivedProperty[] = []

  for (const rawKey of Object.keys(fm)) {
    if (RESERVED_KEYS.has(rawKey)) continue

    // Alias the singular `tag` key to `tags` (Obsidian compat, §4.4).
    const key = rawKey === 'tag' ? 'tags' : rawKey
    const value = fm[rawKey]
    if (value === null || value === undefined) continue

    const isTagKey = key === 'tags'
    const inferred = inferType(value)
    const resolvedType = typeFor ? typeFor(key, inferred) : inferred

    const pushRow = (leaf: string): void => {
      const coerced = isTagKey ? stripTagHash(leaf) : leaf
      if (coerced.length === 0) return
      rows.push({
        key,
        value: coerced,
        value_fold: fold(coerced),
        value_type: resolvedType,
        conforms: conformsToType(coerced, resolvedType) ? 1 : 0
      })
    }

    if (Array.isArray(value)) {
      // One row per element. Skip nested objects/arrays-of-objects.
      for (const el of value) {
        const leaf = coerceScalar(el)
        if (leaf !== null) pushRow(leaf)
      }
    } else {
      const leaf = coerceScalar(value)
      if (leaf !== null) pushRow(leaf)
    }
  }

  return rows
}

/**
 * Pick the deterministic display string for a fold group (§4.2): the
 * most-frequent original, ties broken by MIN(value). `originals` is the list of
 * original (pre-fold) strings that all fold to the same value.
 */
export function tagDisplayString(originals: string[]): string {
  const counts = new Map<string, number>()
  for (const o of originals) counts.set(o, (counts.get(o) ?? 0) + 1)
  let best: string | undefined
  let bestCount = -1
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && (best === undefined || value < best))) {
      best = value
      bestCount = count
    }
  }
  return best ?? ''
}
