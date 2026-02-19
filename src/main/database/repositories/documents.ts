import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { Document } from '../types'
import { maybeCreateAutoVersion } from './document-versions'

export function listDocuments(db: Database.Database, workspaceId?: string): Document[] {
  if (workspaceId) {
    return db
      .prepare('SELECT * FROM documents WHERE workspace_id = ? ORDER BY updated_at DESC')
      .all(workspaceId) as Document[]
  }
  return db.prepare('SELECT * FROM documents ORDER BY updated_at DESC').all() as Document[]
}

export function getDocument(db: Database.Database, id: string): Document | undefined {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Document | undefined
}

export function createDocument(
  db: Database.Database,
  data: { title: string; workspace_id?: string; content?: string; folder_id?: string | null }
): Document {
  const id = randomUUID()
  db.prepare(
    'INSERT INTO documents (id, title, workspace_id, content, folder_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, data.title, data.workspace_id ?? null, data.content ?? null, data.folder_id ?? null)
  return getDocument(db, id)!
}

export function updateDocument(
  db: Database.Database,
  id: string,
  data: { title?: string; workspace_id?: string; content?: string; folder_id?: string | null }
): Document {
  const doc = getDocument(db, id)
  if (!doc) throw new Error(`Document not found: ${id}`)

  // Snapshot the previous content before overwriting
  if (data.content !== undefined) {
    maybeCreateAutoVersion(db, id, doc.title, doc.content)
  }

  const title = data.title ?? doc.title
  const workspace_id = data.workspace_id !== undefined ? data.workspace_id : doc.workspace_id
  const content = data.content !== undefined ? data.content : doc.content
  const folder_id = data.folder_id !== undefined ? data.folder_id : doc.folder_id

  db.prepare(
    "UPDATE documents SET title = ?, workspace_id = ?, content = ?, folder_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(title, workspace_id, content, folder_id, id)

  return getDocument(db, id)!
}

export function searchDocuments(
  db: Database.Database,
  query: string
): (Document & { workspace_name: string })[] {
  return db
    .prepare(
      `SELECT d.*, w.name as workspace_name
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.title LIKE ?
       ORDER BY d.updated_at DESC`
    )
    .all(`%${query}%`) as (Document & { workspace_name: string })[]
}

export function deleteDocument(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM agent_logs WHERE document_id = ?').run(id)
  db.prepare('DELETE FROM documents WHERE id = ?').run(id)
}
