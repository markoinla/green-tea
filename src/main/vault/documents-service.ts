import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { existsSync, renameSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import type { Document } from '../database/types'
import { sanitizeWorkspaceName } from '../agent/paths'
import { maybeCreateAutoVersion } from '../database/repositories/document-versions'
import type { TTDoc } from '../markdown/tiptap-markdown'
import { getWorkspaceVaultDir, ensureVaultDir } from './paths'
import {
  readNote,
  writeNote,
  listVaultNotes,
  slugifyTitle,
  titleFromFilename,
  uniqueNotePath
} from './note-store'

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
}

function nowIso(): string {
  return new Date().toISOString()
}

function getRow(db: Database.Database, id: string): IndexRow | undefined {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as IndexRow | undefined
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
    updated_at: row.updated_at
  }
}

function upsertRow(db: Database.Database, row: IndexRow): void {
  db.prepare(
    `INSERT INTO documents (id, title, content, workspace_id, folder_id, file_path, created_at, updated_at)
     VALUES (@id, @title, @content, @workspace_id, @folder_id, @file_path, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       title = @title, content = @content, workspace_id = @workspace_id,
       folder_id = @folder_id, file_path = @file_path, updated_at = @updated_at`
  ).run(row)
}

// ---------------------------------------------------------------------------
// folders <-> subdirectories (Q6). Folders are flat; one subdir per folder.
// Folder rows are matched to subdirectories by name within a workspace, so the
// index rebuilds consistently from disk on every launch. Ids are stable uuids
// (kept across renames); a wipe+reindex regenerates them consistently.
// ---------------------------------------------------------------------------

function folderSubdir(name: string): string {
  return sanitizeWorkspaceName(name)
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

  const note = readNote(row.file_path)
  const content = JSON.stringify(note.doc)
  const refreshed: IndexRow = {
    ...row,
    title: note.title,
    content,
    created_at: note.created,
    updated_at: note.updated
  }
  // Keep the mirror fresh (file wins) without bumping anything else.
  db.prepare('UPDATE documents SET title = ?, content = ?, updated_at = ? WHERE id = ?').run(
    note.title,
    content,
    note.updated,
    id
  )
  return rowToDocument(refreshed)
}

export function searchDocuments(
  db: Database.Database,
  query: string
): (Document & { workspace_name: string })[] {
  return db
    .prepare(
      `SELECT d.*, w.name as workspace_name
       FROM documents d JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.title LIKE ? ORDER BY d.updated_at DESC`
    )
    .all(`%${query}%`) as (Document & { workspace_name: string })[]
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

function buildFrontmatter(
  id: string,
  title: string,
  filePath: string,
  created: string,
  updated: string
): Record<string, unknown> {
  const fm: Record<string, unknown> = { id }
  // Only store a title override when the filename can't express the title (Q7).
  if (titleFromFilename(filePath) !== title) fm.title = title
  fm.created = created
  fm.updated = updated
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

  const frontmatter = buildFrontmatter(id, data.title, filePath, created, created)
  writeNote(filePath, { frontmatter, doc })

  upsertRow(db, {
    id,
    title: data.title,
    content: JSON.stringify(doc),
    workspace_id: workspaceId,
    folder_id: folder,
    file_path: filePath,
    created_at: created,
    updated_at: created
  })
  return rowToDocument(getRow(db, id)!)
}

export function updateDocument(
  db: Database.Database,
  id: string,
  data: { title?: string; workspace_id?: string; content?: string; folder_id?: string | null }
): Document {
  const row = getRow(db, id)
  if (!row || !row.file_path) throw new Error(`Document not found: ${id}`)

  const current = existsSync(row.file_path) ? readNote(row.file_path) : null
  const doc: TTDoc =
    data.content !== undefined ? (JSON.parse(data.content) as TTDoc) : (current?.doc ?? EMPTY_DOC)

  // Snapshot previous content before overwriting (version history).
  if (data.content !== undefined && current) {
    maybeCreateAutoVersion(db, id, row.title, JSON.stringify(current.doc))
  }

  const title = data.title ?? row.title
  const workspaceId = data.workspace_id ?? row.workspace_id
  const folder = data.folder_id !== undefined ? data.folder_id : row.folder_id
  const created = current?.created ?? row.created_at
  const updated = nowIso()

  // Recompute the path when title/folder/workspace change; rename if needed.
  const targetDir = resolveDir(db, workspaceId, folder)
  const filenameTitleChanged = titleFromFilename(row.file_path) !== slugifyTitle(title)
  const dirChanged = dirname(row.file_path) !== targetDir
  let filePath = row.file_path
  if (dirChanged || filenameTitleChanged) {
    filePath = uniqueNotePath(targetDir, slugifyTitle(title))
  }

  const frontmatter = buildFrontmatter(id, title, filePath, created, updated)
  writeNote(filePath, { frontmatter, doc })
  if (filePath !== row.file_path && existsSync(row.file_path)) {
    rmSync(row.file_path, { force: true })
  }

  upsertRow(db, {
    id,
    title,
    content: JSON.stringify(doc),
    workspace_id: workspaceId,
    folder_id: folder,
    file_path: filePath,
    created_at: created,
    updated_at: updated
  })
  return rowToDocument(getRow(db, id)!)
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

  for (const summary of summaries) {
    const note = readNote(summary.path)
    const fId = summary.folder ? ensureFolderRow(db, workspaceId, summary.folder) : null
    upsertRow(db, {
      id: note.id,
      title: note.title,
      content: JSON.stringify(note.doc),
      workspace_id: workspaceId,
      folder_id: fId,
      file_path: summary.path,
      created_at: note.created,
      updated_at: note.updated
    })
    seen.add(note.id)
  }

  // Drop index rows for this workspace whose files no longer exist.
  const rows = db.prepare('SELECT id FROM documents WHERE workspace_id = ?').all(workspaceId) as {
    id: string
  }[]
  for (const { id } of rows) {
    if (!seen.has(id)) deleteIndexRow(db, id)
  }
}

export function reindexAllWorkspaces(db: Database.Database): void {
  const workspaces = db.prepare('SELECT id FROM workspaces').all() as { id: string }[]
  for (const { id } of workspaces) reindexWorkspace(db, id)
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
