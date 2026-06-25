// Pure, testable model for the inline Properties editor (PLAN Phase 3).
//
// The renderer never writes whole-blob frontmatter: every edit produces a
// `changedKeys` patch sent through `db:documents:updateFrontmatter` (field-merge,
// reserved-key chokepoint on the main side). This module holds the
// frontmatter <-> widget-value mapping and the row-ordering logic, kept free of
// React so it can be unit-tested under the node vitest environment.

import type { PropertyType } from '../../../../../main/vault/metadata'

/** Keys owned by the identity/timestamp layer (mirror of main `RESERVED_KEYS`). */
export const RESERVED_KEYS = ['id', 'title', 'created', 'updated'] as const

/** `id` is hidden entirely; `title`/`created`/`updated` are shown read-only. */
export const READONLY_RESERVED_KEYS = ['created', 'updated'] as const

export const PROPERTY_TYPES: PropertyType[] = ['text', 'number', 'checkbox', 'date', 'list', 'tags']

export interface PropertyRow {
  key: string
  /** Raw frontmatter value (unknown shape until coerced by the widget). */
  value: unknown
  type: PropertyType
}

/**
 * Build the ordered list of editable user-property rows from a frontmatter
 * object and the workspace type registry. Reserved keys are excluded here (they
 * are rendered separately, read-only). The singular `tag` key is aliased to
 * `tags` to mirror the indexer (§4.4); if both exist, the explicit `tags` value
 * wins. Order: registry-known keys first (registry order), then any extra
 * frontmatter keys alphabetically — stable across renders.
 */
export function buildPropertyRows(
  frontmatter: Record<string, unknown>,
  types: { key: string; type: PropertyType }[]
): PropertyRow[] {
  const typeByKey = new Map(types.map((t) => [t.key, t.type]))

  // Normalize frontmatter keys: drop reserved, alias tag -> tags.
  const values = new Map<string, unknown>()
  for (const rawKey of Object.keys(frontmatter)) {
    if (RESERVED_KEYS.includes(rawKey as (typeof RESERVED_KEYS)[number])) continue
    const key = rawKey === 'tag' ? 'tags' : rawKey
    // Explicit `tags` wins over an aliased `tag`.
    if (
      key === 'tags' &&
      rawKey === 'tag' &&
      Object.prototype.hasOwnProperty.call(frontmatter, 'tags')
    )
      continue
    values.set(key, frontmatter[rawKey])
  }

  const seen = new Set<string>()
  const rows: PropertyRow[] = []

  // Registry-known keys first, in registry order.
  for (const t of types) {
    if (RESERVED_KEYS.includes(t.key as (typeof RESERVED_KEYS)[number])) continue
    if (!values.has(t.key)) continue
    rows.push({ key: t.key, value: values.get(t.key), type: t.type })
    seen.add(t.key)
  }

  // Remaining frontmatter keys, alphabetically, inferring a default type.
  const extras = [...values.keys()].filter((k) => !seen.has(k)).sort((a, b) => (a < b ? -1 : 1))
  for (const key of extras) {
    rows.push({
      key,
      value: values.get(key),
      type: typeByKey.get(key) ?? inferDefaultType(values.get(key))
    })
  }

  return rows
}

/** Lightweight client-side type guess for an unregistered key (display only). */
export function inferDefaultType(value: unknown): PropertyType {
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  return 'text'
}

/**
 * Coerce a raw frontmatter value into the string a text/number/date `<input>`
 * should display for the given type. Arrays/objects collapse to a comma string
 * for `list`; everything else uses `String()` with empty for null/undefined.
 */
export function valueToInputString(value: unknown, type: PropertyType): string {
  if (value === null || value === undefined) return ''
  if (type === 'list') return toStringArray(value).join(', ')
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  return String(value)
}

/** Read a raw frontmatter value as a checkbox boolean. */
export function valueToBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return false
}

/** Read a raw frontmatter value as a string[] (for list/tags widgets). */
export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((s) => s.length > 0)
  if (value === null || value === undefined || value === '') return []
  return [String(value)]
}

/**
 * Convert a widget's edited value back into the frontmatter value to merge.
 * Returning `null` signals "delete this key" (the merge chokepoint deletes on
 * null/undefined). Empty text/number/date clear the key; empty list/tags arrays
 * also clear it. Numbers are stored as numbers when parseable, else as the raw
 * string (so a malformed number round-trips without silent loss).
 */
export function inputStringToValue(raw: string, type: PropertyType): unknown {
  const trimmed = raw.trim()
  switch (type) {
    case 'number': {
      if (trimmed === '') return null
      const n = Number(trimmed)
      return Number.isNaN(n) ? raw : n
    }
    case 'list': {
      const items = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      return items.length > 0 ? items : null
    }
    case 'date':
    case 'text':
    default:
      return trimmed === '' ? null : raw
  }
}

/** Normalize a tags/list array for storage: trim, drop empties, dedupe. */
export function normalizeStringArray(items: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const t = item.trim()
    if (t.length === 0) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** The value to merge for a tags/list array, or null to clear the key. */
export function arrayToValue(items: string[]): unknown {
  const norm = normalizeStringArray(items)
  return norm.length > 0 ? norm : null
}

/** Strip a single leading `#` from a typed tag (mirror of indexer §4.4). */
export function stripTagHash(value: string): string {
  return value.startsWith('#') ? value.slice(1) : value
}

/** Validate a new property name for the "+ Add property" flow. */
export function validatePropertyName(
  name: string,
  existingKeys: string[]
): { ok: true; key: string } | { ok: false; error: string } {
  const key = name.trim()
  if (key.length === 0) return { ok: false, error: 'Name required' }
  if ((RESERVED_KEYS as readonly string[]).includes(key))
    return { ok: false, error: `"${key}" is reserved` }
  if (existingKeys.includes(key)) return { ok: false, error: 'Already exists' }
  return { ok: true, key }
}

/** The empty starting value for a freshly-added property of a given type. */
export function defaultValueForType(type: PropertyType): unknown {
  switch (type) {
    case 'checkbox':
      return false
    case 'list':
    case 'tags':
      return []
    default:
      return ''
  }
}
