import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { Folder } from '../types'

export function listFolders(db: Database.Database, workspaceId?: string): Folder[] {
  if (workspaceId) {
    return db
      .prepare('SELECT * FROM folders WHERE workspace_id = ? ORDER BY name ASC')
      .all(workspaceId) as Folder[]
  }
  return db.prepare('SELECT * FROM folders ORDER BY name ASC').all() as Folder[]
}

export function getFolder(db: Database.Database, id: string): Folder | undefined {
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as Folder | undefined
}

export function createFolder(
  db: Database.Database,
  data: { name: string; workspace_id?: string }
): Folder {
  const id = randomUUID()
  db.prepare('INSERT INTO folders (id, name, workspace_id) VALUES (?, ?, ?)').run(
    id,
    data.name,
    data.workspace_id ?? null
  )
  return getFolder(db, id)!
}

export function updateFolder(
  db: Database.Database,
  id: string,
  data: { name?: string; collapsed?: number }
): Folder {
  const folder = getFolder(db, id)
  if (!folder) throw new Error(`Folder not found: ${id}`)

  const name = data.name ?? folder.name
  const collapsed = data.collapsed !== undefined ? data.collapsed : folder.collapsed

  db.prepare(
    "UPDATE folders SET name = ?, collapsed = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(name, collapsed, id)

  return getFolder(db, id)!
}

export function deleteFolder(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM folders WHERE id = ?').run(id)
}
