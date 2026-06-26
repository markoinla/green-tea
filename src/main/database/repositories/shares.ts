import type Database from 'better-sqlite3'
import type { ShareType } from '../../../shared/share-contract'

/**
 * Local index of published shares. Keyed on a STABLE on-disk document identity
 * (`docKey`), never on `documents.id` (which is a disposable, reindex-rebuilt
 * cache). See the `shares` table migration for the full rationale. The `docKey`
 * is computed by the share handler:
 *   note     → `note:<frontmatterUuid>`
 *   artifact → `artifact:<workspaceId>:<workspaceRelPosixPath>`
 */

export interface ShareRow {
  slug: string
  doc_key: string
  workspace_id: string | null
  file_path: string | null
  type: ShareType
  url: string
  title: string | null
  created_at: string
  updated_at: string
}

/** The published share for a document's stable key, or null if not shared. */
export function getShareByDoc(
  db: Database.Database,
  docKey: string
): { slug: string; url: string; type: ShareType } | null {
  const row = db
    .prepare('SELECT slug, url, type FROM shares WHERE doc_key = ?')
    .get(docKey) as { slug: string; url: string; type: ShareType } | undefined
  return row ?? null
}

/**
 * Insert or replace the single share row for a document's stable key. The slug
 * is the primary key but `doc_key` carries the UNIQUE constraint, so an
 * INSERT … ON CONFLICT(doc_key) overwrites in place when re-publishing (the
 * worker is asked to reuse the prior slug, so the slug typically does not
 * change, but this also tolerates a slug change without leaving a stale row).
 */
export function upsertShare(
  db: Database.Database,
  docKey: string,
  data: {
    slug: string
    url: string
    type: ShareType
    workspaceId?: string | null
    filePath?: string | null
    title?: string | null
  }
): void {
  db.prepare(
    `INSERT INTO shares (slug, doc_key, workspace_id, file_path, type, url, title, updated_at)
     VALUES (@slug, @doc_key, @workspace_id, @file_path, @type, @url, @title, datetime('now'))
     ON CONFLICT(doc_key) DO UPDATE SET
       slug = excluded.slug,
       workspace_id = excluded.workspace_id,
       file_path = excluded.file_path,
       type = excluded.type,
       url = excluded.url,
       title = excluded.title,
       updated_at = datetime('now')`
  ).run({
    slug: data.slug,
    doc_key: docKey,
    workspace_id: data.workspaceId ?? null,
    file_path: data.filePath ?? null,
    type: data.type,
    url: data.url,
    title: data.title ?? null
  })
}

/** Remove the share row for a document's stable key (idempotent). */
export function deleteShare(db: Database.Database, docKey: string): void {
  db.prepare('DELETE FROM shares WHERE doc_key = ?').run(docKey)
}
