import type Database from 'better-sqlite3'
import {
  deriveProperties,
  RESERVED_KEYS,
  type DerivedProperty,
  type PropertyType
} from '../../vault/metadata'

/**
 * User-authored EAV properties for non-note ARTIFACTS (PNG/PDF/.csv/.html/…),
 * stored in the `artifact_properties` table. Artifacts can't carry YAML
 * frontmatter, so SQLite is the SOURCE OF TRUTH here (the opposite of notes,
 * whose frontmatter is canonical and `document_properties` is derived).
 *
 * The EAV row shape (key/value/value_fold/value_type/conforms) mirrors
 * `document_properties` exactly, so artifact rows surface alongside note rows in
 * the shared property query (`listByProperty`). All coercion / type-inference /
 * folding is reused from `vault/metadata.ts` — never reimplemented here.
 *
 * Repository pattern: `db: Database.Database` first argument. Type resolution is
 * injected via `typeFor` so this module shares the per-workspace `property_types`
 * registry the notes path uses WITHOUT importing the vault service (no cycle).
 */

/** Resolve the registry type for a key; defaults to the inferred type when absent. */
export type TypeResolver = (key: string, inferred: PropertyType) => PropertyType

/**
 * Replace the artifact's EAV property rows from a raw property object (delete +
 * reinsert in ONE transaction — the integrity invariant, since there is no
 * PRIMARY KEY/UNIQUE). RESERVED_KEYS are skipped by `deriveProperties`. Derives
 * value/value_fold/value_type/conforms via the shared metadata helpers and seeds
 * the property_types registry through `typeFor`.
 */
export function setArtifactProperties(
  db: Database.Database,
  documentId: string,
  props: Record<string, unknown>,
  typeFor: TypeResolver
): void {
  const rows = deriveProperties(props, typeFor)
  db.transaction(() => {
    db.prepare('DELETE FROM artifact_properties WHERE document_id = ?').run(documentId)
    if (rows.length === 0) return
    const insert = db.prepare(
      `INSERT INTO artifact_properties (document_id, key, value, value_fold, value_type, conforms)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const r of rows) {
      insert.run(documentId, r.key, r.value, r.value_fold, r.value_type, r.conforms)
    }
  })()
}

/** Read all EAV property rows for an artifact (raw rows; one per list element). */
export function getArtifactProperties(
  db: Database.Database,
  documentId: string
): DerivedProperty[] {
  return db
    .prepare(
      `SELECT key, value, value_fold, value_type, conforms
       FROM artifact_properties WHERE document_id = ? ORDER BY key ASC`
    )
    .all(documentId) as DerivedProperty[]
}

/** Drop all EAV property rows for an artifact. */
export function deleteArtifactProperties(db: Database.Database, documentId: string): void {
  db.prepare('DELETE FROM artifact_properties WHERE document_id = ?').run(documentId)
}

/** True when the artifact has at least one user-authored property row. */
export function hasArtifactProperties(db: Database.Database, documentId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM artifact_properties WHERE document_id = ? LIMIT 1')
    .get(documentId) as { 1: number } | undefined
  return row !== undefined
}

/** The RESERVED_KEYS a caller must reject before proposing artifact properties. */
export { RESERVED_KEYS }
