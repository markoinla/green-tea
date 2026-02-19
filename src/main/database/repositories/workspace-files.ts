import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { WorkspaceFile } from '../types'

export function listWorkspaceFiles(db: Database.Database, workspaceId: string): WorkspaceFile[] {
  return db
    .prepare('SELECT * FROM workspace_files WHERE workspace_id = ? ORDER BY file_name ASC')
    .all(workspaceId) as WorkspaceFile[]
}

export function addWorkspaceFile(
  db: Database.Database,
  data: { workspace_id: string; file_path: string; file_name: string }
): WorkspaceFile {
  const id = randomUUID()
  db.prepare(
    'INSERT INTO workspace_files (id, workspace_id, file_path, file_name) VALUES (?, ?, ?, ?)'
  ).run(id, data.workspace_id, data.file_path, data.file_name)
  return db.prepare('SELECT * FROM workspace_files WHERE id = ?').get(id) as WorkspaceFile
}

export function removeWorkspaceFile(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM workspace_files WHERE id = ?').run(id)
}
