import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { existsSync, renameSync, rmSync, statSync } from 'fs'
import { dirname, extname, join, relative, sep } from 'path'
import type { Document } from '../database/types'
import { sanitizeWorkspaceName } from '../agent/paths'
import { maybeCreateAutoVersion } from '../database/repositories/document-versions'
import type { TTDoc } from '../markdown/tiptap-markdown'
import { getWorkspaceVaultDir, ensureVaultDir } from './paths'
import { kindForRow } from './artifact-kinds'
import {
  readNote,
  writeNote,
  listVaultNotes,
  slugifyTitle,
  titleFromFilename,
  uniqueNotePath,
  MAX_NOTE_BYTES,
  MAX_ARTIFACT_BYTES
} from './note-store'
import {
  deriveProperties,
  fold,
  tagDisplayString,
  RESERVED_KEYS,
  type PropertyType
} from './metadata'

/**
 * The vault-backed documents service. Markdown files are the source of truth;
 * the SQLite `documents` table is a derived index. This module presents the
 * exact same `Document` shape the renderer already consumes (with `content` as a
 * TipTap JSON string), so the IPC contract and the editor are unchanged — the
 * conversion happens here, at the main-process boundary.
 *
 * Transitional: the index keeps a `content` mirror column populated on every
 * read/write so agent tools and version history (which still read
 * `documents.content`) keep working until they move to files in a later phase.
 */

const EMPTY_DOC: TTDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

interface IndexRow {
  id: string
  title: string
  content: string | null
  workspace_id: string
  folder_id: string | null
  file_path: string | null
  created_at: string
  updated_at: string
  /** Parsed frontmatter cached as JSON (fidelity + change-detection fingerprint). */
  frontmatter: string | null
}

function nowIso(): string {
  return new Date().toISOString()
}

function getRow(db: Database.Database, id: string): IndexRow | undefined {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as IndexRow | undefined
}

/** Parse the cached frontmatter JSON column into an object (safe; never throws). */
function parseFrontmatterColumn(json: string | null): Record<string, unknown> {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Corrupt cache — fall through to an empty object rather than throwing.
  }
  return {}
}

function rowToDocument(row: IndexRow): Document {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    workspace_id: row.workspace_id,
    folder_id: row.folder_id,
    file_path: row.file_path,
    created_at: row.created_at,
    updated_at: row.updated_at,
    frontmatter: parseFrontmatterColumn(row.frontmatter),
    // Derived (not stored): the single funnel for every read path, so the whole
    // app sees `kind` without a schema column or migration.
    kind: kindForRow(row.file_path)
  }
}

/** True when the backing file is a non-note artifact (served, never parsed). */
function isArtifactRow(row: Pick<IndexRow, 'file_path'>): boolean {
  return kindForRow(row.file_path) !== 'note'
}

/**
 * Path-based identity for an artifact (v2): reuse the row already pointing at
 * this exact file (so a same-path rewrite keeps its id and open tabs survive),
 * else mint a fresh id. This is the ONLY identity rule for artifacts — no in-file
 * marker, no frontmatter, no write-back from the indexer.
 */
function idForArtifact(db: Database.Database, absNfcPath: string): string {
  const existing = db.prepare('SELECT id FROM documents WHERE file_path = ?').get(absNfcPath) as
    | { id: string }
    | undefined
  return existing?.id ?? randomUUID()
}

/** Pick a unique `<stem><ext>` within a directory, preserving the artifact's own extension. */
function uniqueArtifactPath(dir: string, stem: string, ext: string): string {
  let candidate = join(dir, `${stem}${ext}`)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem} ${n}${ext}`)
    n++
  }
  return candidate
}

function upsertRow(db: Database.Database, row: IndexRow): void {
  db.prepare(
    `INSERT INTO documents (id, title, content, workspace_id, folder_id, file_path, created_at, updated_at, frontmatter)
     VALUES (@id, @title, @content, @workspace_id, @folder_id, @file_path, @created_at, @updated_at, @frontmatter)
     ON CONFLICT(id) DO UPDATE SET
       title = @title, content = @content, workspace_id = @workspace_id,
       folder_id = @folder_id, file_path = @file_path, updated_at = @updated_at,
       frontmatter = @frontmatter`
  ).run(row)
}

// ---------------------------------------------------------------------------
// metadata derivation (EAV `document_properties` + `property_types` registry)
//
// Every write re-derives a note's rows as a single transaction (delete-by-
// document_id then reinsert), keyed on the RESOLVED docId. The registry is
// auto-seeded only (user_set=0); a user-set type is never re-seeded or
// auto-changed, and the file is never rewritten from here.
// ---------------------------------------------------------------------------

/**
 * Resolve the registry type for (workspace, key), auto-seeding from the inferred
 * type when absent (user_set=0). Never re-seeds or changes a user_set=1 row.
 */
function resolvePropertyType(
  db: Database.Database,
  workspaceId: string,
  key: string,
  inferred: PropertyType
): PropertyType {
  const existing = db
    .prepare('SELECT type FROM property_types WHERE workspace_id = ? AND key = ?')
    .get(workspaceId, key) as { type: string } | undefined
  if (existing) return existing.type as PropertyType
  db.prepare(
    'INSERT INTO property_types (workspace_id, key, type, user_set) VALUES (?, ?, ?, 0)'
  ).run(workspaceId, key, inferred)
  return inferred
}

/**
 * Re-derive the EAV rows for one note and seed the registry. Caller is expected
 * to invoke this inside the same db.transaction() as upsertRow. DB-only: no disk
 * writes, no broadcasts.
 */
function deriveMetadata(
  db: Database.Database,
  docId: string,
  workspaceId: string,
  frontmatter: Record<string, unknown>
): void {
  db.prepare('DELETE FROM document_properties WHERE document_id = ?').run(docId)
  const rows = deriveProperties(frontmatter, (key, inferred) =>
    resolvePropertyType(db, workspaceId, key, inferred)
  )
  if (rows.length === 0) return
  const insert = db.prepare(
    `INSERT INTO document_properties (document_id, key, value, value_fold, value_type, conforms)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const r of rows) {
    insert.run(docId, r.key, r.value, r.value_fold, r.value_type, r.conforms)
  }
}

export interface PropertyTypeEntry {
  key: string
  type: PropertyType
  user_set: number
}

/** List the per-workspace property type registry (auto-seeded + user-set). */
export function getPropertyTypes(db: Database.Database, workspaceId: string): PropertyTypeEntry[] {
  return db
    .prepare(
      'SELECT key, type, user_set FROM property_types WHERE workspace_id = ? ORDER BY key ASC'
    )
    .all(workspaceId) as PropertyTypeEntry[]
}

/**
 * Set a user-authoritative type for (workspace, key): upsert with user_set=1 so
 * it is never auto-re-seeded, then lazily re-derive the EAV rows of every note in
 * the workspace that uses this key (refreshing value_type/conforms). NO file
 * writes and NO frontmatter changes — only the derived index moves.
 */
export function setPropertyType(
  db: Database.Database,
  workspaceId: string,
  key: string,
  type: PropertyType
): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO property_types (workspace_id, key, type, user_set)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(workspace_id, key) DO UPDATE SET type = excluded.type, user_set = 1`
    ).run(workspaceId, key, type)

    // Re-derive only the notes that actually carry this key. deriveMetadata reads
    // the cached frontmatter JSON column (no disk access) and re-resolves the
    // (now user-set) type via resolvePropertyType.
    const affected = db
      .prepare(
        `SELECT DISTINCT d.id, d.frontmatter
         FROM documents d JOIN document_properties p ON p.document_id = d.id
         WHERE d.workspace_id = ? AND p.key = ?`
      )
      .all(workspaceId, key) as { id: string; frontmatter: string | null }[]
    for (const doc of affected) {
      deriveMetadata(db, doc.id, workspaceId, parseFrontmatterColumn(doc.frontmatter))
    }
  })()
}

/**
 * Suggest tags from the workspace-global tag set for the Properties tags chip
 * input. Sources every `key='tags'` value in `document_properties` for the
 * workspace, groups by `value_fold`, and picks the §4.2 deterministic display
 * string per group (most-frequent original, ties broken by MIN(value)). An
 * optional `prefix` filters by fold (case-insensitive substring). Results are
 * ordered by descending frequency, ties by display string ascending.
 */
export function tagSuggest(db: Database.Database, workspaceId: string, prefix = ''): string[] {
  const foldedPrefix = fold(prefix)
  const rows = db
    .prepare(
      `SELECT p.value AS value, p.value_fold AS value_fold
       FROM document_properties p JOIN documents d ON d.id = p.document_id
       WHERE d.workspace_id = ? AND p.key = 'tags'`
    )
    .all(workspaceId) as { value: string; value_fold: string }[]

  // Group original values by their fold so the display rule (§4.2) is applied
  // per canonical tag rather than per raw spelling.
  const groups = new Map<string, string[]>()
  for (const r of rows) {
    if (foldedPrefix && !r.value_fold.includes(foldedPrefix)) continue
    const arr = groups.get(r.value_fold)
    if (arr) arr.push(r.value)
    else groups.set(r.value_fold, [r.value])
  }

  const suggestions = [...groups.values()].map((originals) => ({
    display: tagDisplayString(originals),
    count: originals.length
  }))
  suggestions.sort((a, b) =>
    b.count !== a.count ? b.count - a.count : a.display < b.display ? -1 : 1
  )
  return suggestions.map((s) => s.display)
}

/**
 * Suggest existing property names across the workspace for "+ Add property"
 * name autocomplete. Sources the union of the type registry and any keys present
 * in `document_properties`, filtered by an optional case-insensitive prefix and
 * sorted alphabetically. Reserved keys are never included (they are not indexed).
 */
export function propertyNameSuggest(
  db: Database.Database,
  workspaceId: string,
  prefix = ''
): string[] {
  const foldedPrefix = fold(prefix)
  const rows = db
    .prepare(
      `SELECT key FROM property_types WHERE workspace_id = ?
       UNION
       SELECT DISTINCT p.key FROM document_properties p
       JOIN documents d ON d.id = p.document_id
       WHERE d.workspace_id = ?`
    )
    .all(workspaceId, workspaceId) as { key: string }[]

  const names = rows
    .map((r) => r.key)
    .filter((k) => !RESERVED_KEYS.has(k) && (!foldedPrefix || fold(k).includes(foldedPrefix)))
  return [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Human retrieval (Phase 4): the documents in `workspaceId` that carry the
 * property `key` with a value matching `valueFold`. The predicate is EQUALITY on
 * the stored `value_fold` (case-insensitive, NFC-folded), composed with workspace
 * scoping — `value_fold` is already `fold(value)` so the caller may pass a raw or
 * pre-folded string; we fold it once here so both work. For `date`/`number` the
 * match is on the coerced TEXT (exact), e.g. `priority=2` matches the string `"2"`
 * (L4). Returns the same `Document[]` shape the existing list rendering consumes,
 * ordered by `updated_at DESC` to mirror `listDocuments`.
 */
export function listByProperty(
  db: Database.Database,
  workspaceId: string,
  key: string,
  valueFold: string
): Document[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT d.* FROM documents d
       JOIN document_properties p ON p.document_id = d.id
       WHERE d.workspace_id = ? AND p.key = ? AND p.value_fold = ?
       ORDER BY d.updated_at DESC`
    )
    .all(workspaceId, key, fold(valueFold)) as IndexRow[]
  return rows.map(rowToDocument)
}

// ---------------------------------------------------------------------------
// folders <-> subdirectories (Q6). Folders are flat; one subdir per folder.
// Folder rows are matched to subdirectories by name within a workspace, so the
// index rebuilds consistently from disk on every launch. Ids are stable uuids
// (kept across renames); a wipe+reindex regenerates them consistently.
// ---------------------------------------------------------------------------

// A folder "name" may be a multi-segment POSIX path (e.g. "A/B") when a note is
// discovered in a nested directory on disk. Sanitize each segment but preserve
// the hierarchy so the directory written to is the exact inverse of the one read.
function folderSubdir(name: string): string {
  return name
    .split('/')
    .map((segment) => sanitizeWorkspaceName(segment))
    .join(sep)
}

/** Resolve the on-disk directory for a (workspace, folder) and ensure it exists. */
function resolveDir(db: Database.Database, workspaceId: string, fId: string | null): string {
  const vault = ensureVaultDir(getWorkspaceVaultDir(db, workspaceId))
  if (!fId) return vault
  const folder = db.prepare('SELECT name FROM folders WHERE id = ?').get(fId) as
    | { name: string }
    | undefined
  if (!folder) return vault
  return ensureVaultDir(join(vault, folderSubdir(folder.name)))
}

/** Find (by name within the workspace) or create the folder row for a subdir. */
function ensureFolderRow(db: Database.Database, workspaceId: string, name: string): string {
  const existing = db
    .prepare('SELECT id FROM folders WHERE workspace_id = ? AND name = ?')
    .get(workspaceId, name) as { id: string } | undefined
  if (existing) return existing.id
  const id = randomUUID()
  db.prepare(
    "INSERT INTO folders (id, name, workspace_id, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))"
  ).run(id, name, workspaceId)
  return id
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

export function listDocuments(db: Database.Database, workspaceId?: string): Document[] {
  const rows = (
    workspaceId
      ? db
          .prepare('SELECT * FROM documents WHERE workspace_id = ? ORDER BY updated_at DESC')
          .all(workspaceId)
      : db.prepare('SELECT * FROM documents ORDER BY updated_at DESC').all()
  ) as IndexRow[]
  return rows.map(rowToDocument)
}

export function getDocument(db: Database.Database, id: string): Document | undefined {
  const row = getRow(db, id)
  if (!row) return undefined

  // The file is the source of truth. If it vanished, drop the stale index row.
  if (!row.file_path || !existsSync(row.file_path)) {
    deleteIndexRow(db, id)
    return undefined
  }

  // Artifact: never markdown-parse, never write back. The row IS the metadata
  // (content stays null); the file's bytes are served by the gt-file protocol.
  if (isArtifactRow(row)) {
    return rowToDocument(row)
  }

  const note = readNote(row.file_path)
  const content = JSON.stringify(note.doc)
  const frontmatterJson = JSON.stringify(note.frontmatter)
  const refreshed: IndexRow = {
    ...row,
    title: note.title,
    content,
    created_at: note.created,
    updated_at: note.updated,
    frontmatter: frontmatterJson
  }
  // Keep the mirror fresh (file wins) — but only write when something actually
  // changed, so a plain read has no side effect on the table. The frontmatter
  // fingerprint is part of the gate so a metadata-only external edit re-derives
  // the EAV rows, while a plain open never churns them (M1).
  const changed =
    row.title !== note.title ||
    row.content !== content ||
    row.updated_at !== note.updated ||
    row.frontmatter !== frontmatterJson
  if (changed) {
    db.transaction(() => {
      db.prepare(
        'UPDATE documents SET title = ?, content = ?, updated_at = ?, frontmatter = ? WHERE id = ?'
      ).run(note.title, content, note.updated, frontmatterJson, id)
      deriveMetadata(db, id, row.workspace_id, note.frontmatter)
    })()
  }
  return rowToDocument(refreshed)
}

export function searchDocuments(
  db: Database.Database,
  query: string
): (Document & { workspace_name: string })[] {
  const rows = db
    .prepare(
      `SELECT d.*, w.name as workspace_name
       FROM documents d JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.title LIKE ? ORDER BY d.updated_at DESC`
    )
    .all(`%${query}%`) as (IndexRow & { workspace_name: string })[]
  // Map through rowToDocument so artifacts carry `kind` (title-only match — their
  // content is null and never searched).
  return rows.map((r) => ({ ...rowToDocument(r), workspace_name: r.workspace_name }))
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

// Merge our managed identity/timestamp keys OVER the note's existing
// frontmatter, so arbitrary user properties (tags, status, anything) survive
// every write. Only `id`, `title`, `created`, `updated` are owned by us; all
// other keys pass through untouched (closes the frontmatter data-loss bug).
function buildFrontmatter(
  existingFm: Record<string, unknown>,
  id: string,
  title: string,
  filePath: string,
  created: string,
  updated: string
): Record<string, unknown> {
  const fm: Record<string, unknown> = { ...existingFm, id, created, updated }
  // Only store a title override when the filename can't express the title (Q7);
  // otherwise strip any stale title key so the filename remains the title.
  if (titleFromFilename(filePath) !== title) {
    fm.title = title
  } else {
    delete fm.title
  }
  return fm
}

export function createDocument(
  db: Database.Database,
  data: { title: string; workspace_id?: string; content?: string; folder_id?: string | null }
): Document {
  const workspaceId = data.workspace_id ?? defaultWorkspaceId(db)
  const id = randomUUID()
  const doc: TTDoc = data.content ? (JSON.parse(data.content) as TTDoc) : EMPTY_DOC
  const folder = data.folder_id ?? null

  const dir = resolveDir(db, workspaceId, folder)
  const filePath = uniqueNotePath(dir, slugifyTitle(data.title))
  const created = nowIso()

  const frontmatter = buildFrontmatter({}, id, data.title, filePath, created, created)
  writeNote(filePath, { frontmatter, doc })

  db.transaction(() => {
    upsertRow(db, {
      id,
      title: data.title,
      content: JSON.stringify(doc),
      workspace_id: workspaceId,
      folder_id: folder,
      file_path: filePath,
      created_at: created,
      updated_at: created,
      frontmatter: JSON.stringify(frontmatter)
    })
    deriveMetadata(db, id, workspaceId, frontmatter)
  })()
  return rowToDocument(getRow(db, id)!)
}

/**
 * Artifact rename/move (v2). Title → filename and folder/workspace → directory,
 * preserving the file's own extension with a single `renameSync` (no markdown
 * path, no frontmatter, no content). The id is kept — the row's `file_path` is
 * updated in place, so a later watcher reconcile finds it by path and never
 * mints a duplicate. `content` stays null.
 */
function updateArtifact(
  db: Database.Database,
  row: IndexRow,
  data: { title?: string; workspace_id?: string; folder_id?: string | null }
): Document {
  const oldPath = row.file_path as string
  const workspaceId = data.workspace_id ?? row.workspace_id
  const folder = data.folder_id !== undefined ? data.folder_id : row.folder_id

  const titleChanged = data.title !== undefined && data.title !== row.title
  const folderChanged = data.folder_id !== undefined && (data.folder_id ?? null) !== row.folder_id
  const workspaceChanged = data.workspace_id !== undefined && data.workspace_id !== row.workspace_id

  let filePath = oldPath
  if (titleChanged || folderChanged || workspaceChanged) {
    const targetDir = resolveDir(db, workspaceId, folder)
    const stem = data.title !== undefined ? slugifyTitle(data.title) : titleFromFilename(oldPath)
    filePath = uniqueArtifactPath(targetDir, stem, extname(oldPath))
    if (filePath !== oldPath) renameSync(oldPath, filePath)
  }

  const updated = nowIso()
  upsertRow(db, {
    id: row.id,
    // Display title tracks the filename (artifacts can't carry a title override),
    // so it matches what a reindex would derive — no flap.
    title: titleFromFilename(filePath),
    content: null,
    workspace_id: workspaceId,
    folder_id: folder,
    file_path: filePath,
    created_at: row.created_at,
    updated_at: updated,
    frontmatter: null
  })
  return rowToDocument(getRow(db, row.id)!)
}

export function updateDocument(
  db: Database.Database,
  id: string,
  data: { title?: string; workspace_id?: string; content?: string; folder_id?: string | null }
): Document {
  const row = getRow(db, id)
  if (!row || !row.file_path) throw new Error(`Document not found: ${id}`)

  // The file is the source of truth. If it vanished externally, drop the stale
  // row rather than recreating the note from an empty doc (which would destroy
  // content on a title/folder-only edit).
  if (!existsSync(row.file_path)) {
    deleteIndexRow(db, id)
    throw new Error(`Document file missing, removed from index: ${id}`)
  }

  // Artifact: rename/move ONLY (title → filename, folder → directory), preserving
  // the file's own extension via a plain renameSync. NEVER readNote/writeNote/
  // buildFrontmatter (markdown machinery) and never `content` — that would parse
  // an .html as a note, rewrite it with frontmatter, and rmSync the original.
  if (isArtifactRow(row)) {
    return updateArtifact(db, row, data)
  }

  const current = readNote(row.file_path)
  const doc: TTDoc = data.content !== undefined ? (JSON.parse(data.content) as TTDoc) : current.doc

  // Snapshot previous content before overwriting (version history).
  if (data.content !== undefined) {
    maybeCreateAutoVersion(db, id, row.title, JSON.stringify(current.doc))
  }

  const title = data.title ?? row.title
  const workspaceId = data.workspace_id ?? row.workspace_id
  const folder = data.folder_id !== undefined ? data.folder_id : row.folder_id
  const created = current.created
  const updated = nowIso()

  // Rename/move the file ONLY when the title, folder, or workspace genuinely
  // changes — never on a content-only autosave (which would churn the filename
  // and pollute frontmatter with title overrides).
  const titleChanged = data.title !== undefined && data.title !== row.title
  const folderChanged = data.folder_id !== undefined && (data.folder_id ?? null) !== row.folder_id
  const workspaceChanged = data.workspace_id !== undefined && data.workspace_id !== row.workspace_id
  let filePath = row.file_path
  if (titleChanged || folderChanged || workspaceChanged) {
    const targetDir = resolveDir(db, workspaceId, folder)
    filePath = uniqueNotePath(targetDir, slugifyTitle(title))
  }

  const frontmatter = buildFrontmatter(current.frontmatter, id, title, filePath, created, updated)
  writeNote(filePath, { frontmatter, doc })
  if (filePath !== row.file_path && existsSync(row.file_path)) {
    rmSync(row.file_path, { force: true })
  }

  db.transaction(() => {
    upsertRow(db, {
      id,
      title,
      content: JSON.stringify(doc),
      workspace_id: workspaceId,
      folder_id: folder,
      file_path: filePath,
      created_at: created,
      updated_at: updated,
      frontmatter: JSON.stringify(frontmatter)
    })
    deriveMetadata(db, id, workspaceId, frontmatter)
  })()
  return rowToDocument(getRow(db, id)!)
}

/**
 * The single reserved-key chokepoint (M2). Merge `changedKeys` into the note's
 * existing frontmatter and persist, re-deriving the index in one transaction.
 * Used by BOTH the renderer and the agent/approval path.
 *
 * - Reads with persistBackfill=false so a stray pre-write FS event isn't minted.
 * - MERGES only the keys in `changedKeys`; a key whose value is `null`/`undefined`
 *   is deleted (property cleared), everything else is overwritten. Unrelated keys
 *   pass through untouched.
 * - RESERVED_KEYS in `changedKeys` are silently dropped; the dropped names are
 *   returned in `rejectedKeys` so the agent path can surface them. The managed
 *   id/title/created/updated keys are re-applied by buildFrontmatter regardless,
 *   so a stale caller can never overwrite them.
 * - writeNote → markSelfWrite suppresses the watcher echo.
 */
export function updateFrontmatter(
  db: Database.Database,
  id: string,
  changedKeys: Record<string, unknown>
): { document: Document; rejectedKeys: string[] } {
  const row = getRow(db, id)
  if (!row || !row.file_path) throw new Error(`Document not found: ${id}`)

  if (!existsSync(row.file_path)) {
    deleteIndexRow(db, id)
    throw new Error(`Document file missing, removed from index: ${id}`)
  }

  // Artifacts have no frontmatter — readNote+writeNote here would parse an .html
  // as a note and rewrite it with a `---` block. Reject loudly instead.
  if (isArtifactRow(row)) {
    throw new Error(`Cannot set metadata on an artifact: ${id}`)
  }

  // Read WITHOUT persist-backfill: a pre-write backfill would emit a stray FS
  // event the watcher would then have to reconcile.
  const current = readNote(row.file_path, false)

  const rejectedKeys: string[] = []
  const merged: Record<string, unknown> = { ...current.frontmatter }
  for (const key of Object.keys(changedKeys)) {
    if (RESERVED_KEYS.has(key)) {
      rejectedKeys.push(key)
      continue
    }
    const value = changedKeys[key]
    if (value === null || value === undefined) {
      delete merged[key]
    } else {
      merged[key] = value
    }
  }

  const created = current.created
  const updated = nowIso()
  // buildFrontmatter re-applies the managed identity/timestamp keys over the
  // merged object, so id/title/created stay authoritative no matter what.
  const frontmatter = buildFrontmatter(merged, id, row.title, row.file_path, created, updated)
  writeNote(row.file_path, { frontmatter, doc: current.doc })

  db.transaction(() => {
    db.prepare('UPDATE documents SET updated_at = ?, frontmatter = ? WHERE id = ?').run(
      updated,
      JSON.stringify(frontmatter),
      id
    )
    deriveMetadata(db, id, row.workspace_id, frontmatter)
  })()

  return { document: rowToDocument(getRow(db, id)!), rejectedKeys }
}

export function deleteDocument(db: Database.Database, id: string): void {
  const row = getRow(db, id)
  if (row?.file_path && existsSync(row.file_path)) {
    rmSync(row.file_path, { force: true })
  }
  deleteIndexRow(db, id)
}

function deleteIndexRow(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM agent_logs WHERE document_id = ?').run(id)
  db.prepare('DELETE FROM documents WHERE id = ?').run(id)
}

// ---------------------------------------------------------------------------
// folder operations (mirror to subdirectories)
// ---------------------------------------------------------------------------

export function createFolder(
  db: Database.Database,
  data: { name: string; workspace_id: string }
): { id: string; name: string; workspace_id: string; collapsed: number } {
  const id = ensureFolderRow(db, data.workspace_id, data.name)
  ensureVaultDir(
    join(ensureVaultDir(getWorkspaceVaultDir(db, data.workspace_id)), folderSubdir(data.name))
  )
  return { id, name: data.name, workspace_id: data.workspace_id, collapsed: 0 }
}

export function renameFolder(db: Database.Database, id: string, name: string): void {
  const folder = db.prepare('SELECT name, workspace_id FROM folders WHERE id = ?').get(id) as
    | { name: string; workspace_id: string }
    | undefined
  if (!folder) return
  const vault = getWorkspaceVaultDir(db, folder.workspace_id)
  const oldDir = join(vault, folderSubdir(folder.name))
  const newDir = join(vault, folderSubdir(name))
  if (existsSync(oldDir) && !existsSync(newDir)) renameSync(oldDir, newDir)
  db.prepare("UPDATE folders SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id)
  // The files moved with the directory; refresh file_path in the index.
  reindexWorkspace(db, folder.workspace_id)
}

export function deleteFolder(db: Database.Database, id: string): void {
  const folder = db.prepare('SELECT name, workspace_id FROM folders WHERE id = ?').get(id) as
    | { name: string; workspace_id: string }
    | undefined
  if (folder) {
    const dir = join(getWorkspaceVaultDir(db, folder.workspace_id), folderSubdir(folder.name))
    if (existsSync(dir)) {
      // Remove the directory and its notes; index rows are pruned via reindex.
      rmSync(dir, { recursive: true, force: true })
    }
    db.prepare('DELETE FROM documents WHERE folder_id = ?').run(id)
  }
  db.prepare('DELETE FROM folders WHERE id = ?').run(id)
}

// ---------------------------------------------------------------------------
// reindex (rebuild the derived index from disk)
// ---------------------------------------------------------------------------

export function reindexWorkspace(db: Database.Database, workspaceId: string): void {
  const vaultDir = ensureVaultDir(getWorkspaceVaultDir(db, workspaceId))
  const summaries = listVaultNotes(vaultDir)
  const seen = new Set<string>()
  const seenFolders = new Set<string>()

  for (const summary of summaries) {
    const fId = summary.folder ? ensureFolderRow(db, workspaceId, summary.folder) : null
    if (fId) seenFolders.add(fId)

    if (summary.kind !== 'note') {
      // Artifact: path-derived id, content=null, NO readNote / deriveMetadata /
      // write-back. `updated_at` carries the file mtime as the change fingerprint
      // (the indexer never reads the body). `created_at` is preserved across a
      // rewrite by reusing the existing row's value.
      const absPath = summary.path.normalize('NFC')
      const docId = idForArtifact(db, absPath)
      const existing = getRow(db, docId)
      upsertRow(db, {
        id: docId,
        title: summary.title,
        content: null,
        workspace_id: workspaceId,
        folder_id: fId,
        file_path: absPath,
        created_at: existing?.created_at ?? summary.updated,
        updated_at: summary.updated,
        frontmatter: null
      })
      seen.add(docId)
      continue
    }

    const note = readNote(summary.path)
    db.transaction(() => {
      upsertRow(db, {
        id: note.id,
        title: note.title,
        content: JSON.stringify(note.doc),
        workspace_id: workspaceId,
        folder_id: fId,
        file_path: summary.path,
        created_at: note.created,
        updated_at: note.updated,
        frontmatter: JSON.stringify(note.frontmatter)
      })
      deriveMetadata(db, note.id, workspaceId, note.frontmatter)
    })()
    seen.add(note.id)
  }

  // Drop index rows for this workspace whose files no longer exist.
  const rows = db.prepare('SELECT id FROM documents WHERE workspace_id = ?').all(workspaceId) as {
    id: string
  }[]
  for (const { id } of rows) {
    if (!seen.has(id)) deleteIndexRow(db, id)
  }

  // Drop folder rows whose subdirectory is gone (no notes were found in it).
  // An empty-but-present directory keeps its folder row only if it still exists.
  const folderRows = db
    .prepare('SELECT id, name FROM folders WHERE workspace_id = ?')
    .all(workspaceId) as { id: string; name: string }[]
  for (const folder of folderRows) {
    if (seenFolders.has(folder.id)) continue
    if (!existsSync(join(vaultDir, folderSubdir(folder.name)))) {
      db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id)
    }
  }
}

export function reindexAllWorkspaces(db: Database.Database): void {
  const workspaces = db.prepare('SELECT id FROM workspaces').all() as { id: string }[]
  for (const { id } of workspaces) reindexWorkspace(db, id)
}

// ---------------------------------------------------------------------------
// single-file reconcile (used by the vault watcher, Phase 5)
//
// reindexFile is PURE with respect to the app: it reconciles ONE .md path
// against the index and returns a result describing what changed. It never
// broadcasts, never checks the self-write registry, and never writes to disk
// (readNote is called with persistBackfill=false). The watcher owns all of
// that, which keeps the dependency graph a DAG (no watcher import here).
// ---------------------------------------------------------------------------

export type ReindexResult =
  | { kind: 'created'; docId: string; structuralChanged: true }
  | { kind: 'updated'; docId: string; structuralChanged: boolean }
  | { kind: 'deleted'; docId: string }
  | { kind: 'unchanged'; docId: string }
  | { kind: 'ignored' }

/** NFC POSIX path of `dir` relative to `base` ('' when they are the same dir). */
function toPosixRel(base: string, dir: string): string {
  const rel = relative(base, dir)
  return rel.split(sep).join('/').normalize('NFC')
}

/** [{ workspaceId, dir (NFC, no trailing sep) }], sorted longest dir first. */
export function getVaultDirsByWorkspace(
  db: Database.Database
): { workspaceId: string; dir: string }[] {
  const rows = db.prepare('SELECT id FROM workspaces').all() as { id: string }[]
  return rows
    .map((r) => ({ workspaceId: r.id, dir: getWorkspaceVaultDir(db, r.id).normalize('NFC') }))
    .sort((a, b) => b.dir.length - a.dir.length)
}

/**
 * True when an absolute path is the vault dir of any workspace, or lives inside
 * one. Used to reject adding a vault-internal file to the flat Files section (it
 * is already a first-class document/artifact in the tree — no double-listing).
 */
export function isPathInsideAnyVault(db: Database.Database, absPathRaw: string): boolean {
  const abs = absPathRaw.normalize('NFC')
  for (const { dir } of getVaultDirsByWorkspace(db)) {
    if (abs === dir || abs.startsWith(dir + sep)) return true
  }
  return false
}

/** Owning workspace for an absolute (NFC) path, or null if it has none. */
function resolveWorkspaceForPath(db: Database.Database, absNfc: string): string | null {
  for (const { workspaceId, dir } of getVaultDirsByWorkspace(db)) {
    if (absNfc === dir) return null // the workspace dir itself, not a file in it
    if (absNfc.startsWith(dir + sep)) return workspaceId
  }
  return null // file lives directly in vaults/ root with no owning workspace
}

/**
 * Remove the index row whose file_path matches (NFC). Returns the removed
 * docId, or null if no row matched. The watcher calls this at delete-settle
 * time rather than eagerly, so a delete+recreate flap (or an external rename
 * processed old-path-first) never churns a still-valid row.
 */
export function deleteIndexRowByPath(db: Database.Database, absPathRaw: string): string | null {
  const abs = absPathRaw.normalize('NFC')
  const row = db.prepare('SELECT id FROM documents WHERE file_path = ?').get(abs) as
    | { id: string }
    | undefined
  if (!row) return null
  deleteIndexRow(db, row.id)
  return row.id
}

export function reindexFile(db: Database.Database, absPathRaw: string): ReindexResult {
  const abs = absPathRaw.normalize('NFC')

  // --- DELETE branch: the file is gone. Report it but DON'T prune the row here
  // — the watcher confirms the deletion after a settle window and prunes then,
  // so a transient disappearance (rename/atomic-replace) can't drop a live row.
  if (!existsSync(abs)) {
    const row = db.prepare('SELECT id FROM documents WHERE file_path = ?').get(abs) as
      | { id: string }
      | undefined
    if (!row) return { kind: 'ignored' }
    return { kind: 'deleted', docId: row.id }
  }

  // --- workspace resolution -------------------------------------------------
  const workspaceId = resolveWorkspaceForPath(db, abs)
  if (!workspaceId) return { kind: 'ignored' }

  // --- cheap pre-checks before the TipTap conversion ------------------------
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(abs)
  } catch {
    return { kind: 'ignored' }
  }
  if (!stat.isFile()) return { kind: 'ignored' }

  const fileKind = kindForRow(abs)

  // --- artifact reconcile: path identity, content=null, NO readNote / write- ---
  // back. `updated_at` carries the mtime as the change fingerprint, so an agent
  // rewriting report.html (same path, new bytes) reports `updated` → the viewer
  // live-reloads, even though the index never reads the body.
  if (fileKind !== 'note') {
    if (stat.size > MAX_ARTIFACT_BYTES) return { kind: 'ignored' }
    const mtimeIso = stat.mtime.toISOString()
    const vaultDir = getWorkspaceVaultDir(db, workspaceId).normalize('NFC')
    const folderRel = toPosixRel(vaultDir, dirname(abs))
    const folderId = folderRel ? ensureFolderRow(db, workspaceId, folderRel) : null
    const title = titleFromFilename(abs)

    const existing = db.prepare('SELECT * FROM documents WHERE file_path = ?').get(abs) as
      | IndexRow
      | undefined
    if (
      existing &&
      existing.title === title &&
      existing.folder_id === folderId &&
      existing.workspace_id === workspaceId &&
      existing.updated_at === mtimeIso
    ) {
      return { kind: 'unchanged', docId: existing.id }
    }

    const docId = existing?.id ?? randomUUID()
    const structuralChanged =
      !existing || existing.title !== title || existing.folder_id !== folderId
    upsertRow(db, {
      id: docId,
      title,
      content: null,
      workspace_id: workspaceId,
      folder_id: folderId,
      file_path: abs,
      created_at: existing?.created_at ?? mtimeIso,
      updated_at: mtimeIso,
      frontmatter: null
    })
    return existing
      ? { kind: 'updated', docId, structuralChanged }
      : { kind: 'created', docId, structuralChanged: true }
  }

  if (stat.size > MAX_NOTE_BYTES) return { kind: 'ignored' }

  // --- read (READ-ONLY: persistBackfill=false so we never write from here) ---
  let note: ReturnType<typeof readNote>
  try {
    note = readNote(abs, false)
  } catch {
    return { kind: 'ignored' }
  }
  const content = JSON.stringify(note.doc)
  const frontmatterJson = JSON.stringify(note.frontmatter)

  const vaultDir = getWorkspaceVaultDir(db, workspaceId).normalize('NFC')
  const folderRel = toPosixRel(vaultDir, dirname(abs))
  const folderId = folderRel ? ensureFolderRow(db, workspaceId, folderRel) : null

  // Find the existing row by stable frontmatter id first (immune to path
  // normalization / case), then by NFC file_path as a fallback.
  let row = note.id ? getRow(db, note.id) : undefined
  if (!row) {
    row = db.prepare('SELECT * FROM documents WHERE file_path = ?').get(abs) as IndexRow | undefined
  }

  // The equality test EXCLUDES updated_at: it is mtime-derived and not
  // deterministic across a write, so including it would echo every app save.
  // It INCLUDES a frontmatter fingerprint (C2): a metadata-only external edit
  // changes neither title/content/folder, so without this the EAV index would
  // silently drift. Keep this PURE w.r.t. disk — EAV/registry writes are DB-only.
  if (
    row &&
    row.title === note.title &&
    row.content === content &&
    row.folder_id === folderId &&
    row.frontmatter === frontmatterJson
  ) {
    if (row.file_path !== abs || row.workspace_id !== workspaceId) {
      db.prepare('UPDATE documents SET file_path = ?, workspace_id = ? WHERE id = ?').run(
        abs,
        workspaceId,
        row.id
      )
    }
    return { kind: 'unchanged', docId: row.id }
  }

  // Prefer the existing row's stable id. A frontmatter-less file mints a fresh
  // ephemeral id on every read (persistBackfill=false here), so keying the upsert
  // on note.id would INSERT a second row for the same path on each content change
  // — reuse the path-matched row's id to update it in place instead. The EAV/
  // registry writes are keyed on this RESOLVED docId (L1), never note.id.
  const docId = row?.id ?? note.id
  const structuralChanged = !row || row.title !== note.title || row.folder_id !== folderId
  db.transaction(() => {
    upsertRow(db, {
      id: docId,
      title: note.title,
      content,
      workspace_id: workspaceId,
      folder_id: folderId,
      file_path: abs,
      created_at: note.created,
      updated_at: note.updated,
      frontmatter: frontmatterJson
    })
    deriveMetadata(db, docId, workspaceId, note.frontmatter)
  })()
  return row
    ? { kind: 'updated', docId, structuralChanged }
    : { kind: 'created', docId, structuralChanged: true }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function defaultWorkspaceId(db: Database.Database): string {
  const ws = db.prepare('SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1').get() as
    | { id: string }
    | undefined
  if (!ws) throw new Error('No workspace exists')
  return ws.id
}
