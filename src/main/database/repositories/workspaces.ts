import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { Workspace } from '../types'

export function listWorkspaces(db: Database.Database): Workspace[] {
  return db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all() as Workspace[]
}

export function getWorkspace(db: Database.Database, id: string): Workspace | undefined {
  return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace | undefined
}

export function createWorkspace(db: Database.Database, data: { name: string }): Workspace {
  const id = randomUUID()
  db.prepare('INSERT INTO workspaces (id, name) VALUES (?, ?)').run(id, data.name)
  return getWorkspace(db, id)!
}

export function updateWorkspace(
  db: Database.Database,
  id: string,
  data: { name?: string; description?: string; memory?: string }
): Workspace {
  const workspace = getWorkspace(db, id)
  if (!workspace) throw new Error(`Workspace not found: ${id}`)

  const name = data.name ?? workspace.name
  const description = data.description !== undefined ? data.description : workspace.description
  const memory = data.memory !== undefined ? data.memory : workspace.memory

  db.prepare(
    "UPDATE workspaces SET name = ?, description = ?, memory = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(name, description, memory, id)

  return getWorkspace(db, id)!
}

export function deleteWorkspace(db: Database.Database, id: string): void {
  // Check this is not the last workspace
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM workspaces').get() as { cnt: number }).cnt
  if (count <= 1) throw new Error('Cannot delete the last workspace')

  // Delete all agent_logs, documents, and folders in this workspace (cascade)
  db.prepare(
    'DELETE FROM agent_logs WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = ?)'
  ).run(id)
  db.prepare('DELETE FROM documents WHERE workspace_id = ?').run(id)
  db.prepare('DELETE FROM folders WHERE workspace_id = ?').run(id)
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
}
