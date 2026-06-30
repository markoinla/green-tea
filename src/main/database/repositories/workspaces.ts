import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { join, resolve, sep } from 'path'
import type { Workspace } from '../types'
import { getAgentBaseDir, RESERVED_WORKSPACE_NAMES } from '../../agent/paths'

export function listWorkspaces(db: Database.Database): Workspace[] {
  return db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all() as Workspace[]
}

export function getWorkspace(db: Database.Database, id: string): Workspace | undefined {
  return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace | undefined
}

/**
 * Canonicalize a folder path for comparison: absolute, NFC-normalized (so Unicode
 * filename variants match), no trailing separator. Used by findByPath /
 * assertNoOverlap so the same folder can't be registered twice under different
 * spellings.
 */
export function normalizePath(path: string): string {
  const abs = resolve(path).normalize('NFC')
  // Strip a trailing separator (but keep the root '/').
  return abs.length > 1 && abs.endsWith(sep) ? abs.slice(0, -1) : abs
}

/** Find a workspace whose stored path equals the given path (after normalization). */
export function findByPath(db: Database.Database, path: string): Workspace | undefined {
  const target = normalizePath(path)
  return listWorkspaces(db).find((w) => w.path && normalizePath(w.path) === target)
}

/**
 * Reject a candidate folder that equals, contains, or is contained by an existing
 * workspace folder. We keep one global DB keyed by path, so overlapping folders
 * would map the same file to two workspaces — stricter than Obsidian, by design.
 * Throws an Error whose message names the conflicting workspace.
 */
export function assertNoOverlap(db: Database.Database, path: string): void {
  const target = normalizePath(path)

  // Reserve app-managed config paths: a workspace folder may not be (or live
  // inside) the hidden config dirs (`.settings/`, `.greentea/`, legacy
  // `workspaces/`) or a config item (skills/plugins/agents/mcp.json/theme.json)
  // under the base dir. Compared case-insensitively so `.Settings` collides with
  // `.settings` on a default (case-insensitive) macOS filesystem.
  const base = getAgentBaseDir(db)
  const targetCI = target.toLowerCase()
  for (const name of RESERVED_WORKSPACE_NAMES) {
    const reserved = normalizePath(join(base, name)).toLowerCase()
    if (targetCI === reserved || targetCI.startsWith(reserved + sep)) {
      throw new Error(`"${name}" is reserved for Green Tea and can't be used as a workspace folder.`)
    }
  }

  for (const w of listWorkspaces(db)) {
    if (!w.path) continue
    const existing = normalizePath(w.path)
    if (existing === target) {
      throw new Error(`This folder is already part of "${w.name}".`)
    }
    // Containment either way (compare with a trailing separator so a sibling like
    // `/a/research2` is not treated as nested under `/a/research`).
    if (target.startsWith(existing + sep)) {
      throw new Error(`This folder is inside "${w.name}".`)
    }
    if (existing.startsWith(target + sep)) {
      throw new Error(`This folder contains "${w.name}".`)
    }
  }
}

export function createWorkspace(
  db: Database.Database,
  data: { name: string; path?: string }
): Workspace {
  const id = randomUUID()
  // `path` is the workspace's folder on disk. Callers (the IPC layer) normally
  // resolve it — to a picked folder or the default location — before inserting.
  // When omitted (e.g. unit tests), the column keeps its '' default and path
  // resolution falls back to the default location derived from the name.
  db.prepare('INSERT INTO workspaces (id, name, path) VALUES (?, ?, ?)').run(
    id,
    data.name,
    data.path ?? ''
  )
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

/** Update only a workspace's stored folder path (e.g. after a folder rename). */
export function setWorkspacePath(db: Database.Database, id: string, path: string): void {
  db.prepare("UPDATE workspaces SET path = ?, updated_at = datetime('now') WHERE id = ?").run(
    path,
    id
  )
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
