import type Database from 'better-sqlite3'

/**
 * Per-document VIEW-STATE for the table artifact — column widths and sort. This is
 * local, volatile UI state, deliberately kept in SQLite rather than on disk (the
 * schema sidecar handles types) so its frequent churn never touches git or sync.
 * `view_state` is an opaque JSON blob owned by the renderer (TableViewer); the
 * main process only stores and returns it verbatim.
 */

export function getViewState(db: Database.Database, documentId: string): string | null {
  const row = db
    .prepare('SELECT view_state FROM document_view_state WHERE document_id = ?')
    .get(documentId) as { view_state: string } | undefined
  return row?.view_state ?? null
}

export function setViewState(db: Database.Database, documentId: string, viewState: string): void {
  db.prepare(
    `INSERT INTO document_view_state (document_id, view_state, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(document_id) DO UPDATE SET view_state = excluded.view_state, updated_at = excluded.updated_at`
  ).run(documentId, viewState)
}
