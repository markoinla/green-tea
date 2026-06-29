import type Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteFile } from './note-store'
import { markSelfWrite } from './self-write'
import { getWorkspaceVaultDir } from './paths'

/**
 * Workspace description & memory as visible, indexed markdown files at the
 * workspace ROOT — `README.md` (human-authored project context; the conventional
 * name, so an existing folder's README is adopted as-is) and `MEMORY.md`
 * (agent-managed notebook). They are NOT hidden in `.greentea/`: being `.md`
 * files at the root, the vault watcher indexes them and the existing note editor
 * edits them — zero bespoke UI.
 *
 * Writes go through `markSelfWrite` + `atomicWriteFile` (the note write path) so
 * the watcher recognizes the app's own bytes and never echo-loops.
 *
 * `ensureWorkspaceDocs` is CREATE-EMPTY-ONLY and FOLDER-EXISTENCE-GATED: it
 * plants a blank file only when one is missing, never overwrites existing
 * content, and is a no-op when the workspace folder is absent (an unavailable
 * workspace — mirror the watcher's "skip missing folders, never mkdir them
 * back" rule). A deleted file therefore returns BLANK on restart; old content is
 * never restored from the DB or any cache (deleting memory is a legitimate
 * "forget" gesture). DB→file backfill happens only in the migration.
 */

export const WORKSPACE_DESCRIPTION_FILE = 'README.md'
export const WORKSPACE_MEMORY_FILE = 'MEMORY.md'

export type WorkspaceDocKind = 'description' | 'memory'

function fileForKind(kind: WorkspaceDocKind): string {
  return kind === 'description' ? WORKSPACE_DESCRIPTION_FILE : WORKSPACE_MEMORY_FILE
}

/**
 * Absolute path of a workspace doc on disk. Exposed so callers that just wrote a
 * doc can reindex it (the file is an indexed note; see `writeWorkspaceDoc`).
 */
export function workspaceDocPath(
  db: Database.Database,
  workspaceId: string,
  kind: WorkspaceDocKind
): string {
  return join(getWorkspaceVaultDir(db, workspaceId), fileForKind(kind))
}

/**
 * Read a workspace doc from disk. Returns '' if the workspace folder OR the file
 * is absent — a missing file is never a hard error (readers tolerate absence).
 */
export function readWorkspaceDoc(
  db: Database.Database,
  workspaceId: string,
  kind: WorkspaceDocKind
): string {
  const path = workspaceDocPath(db, workspaceId, kind)
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf-8')
}

/**
 * Write a workspace doc (create or full overwrite). Marks the self-write BEFORE
 * the atomic write so the watcher ignores its own bytes. Assumes the workspace
 * folder exists (it does for any active workspace).
 *
 * NOTE: this only touches the FILE. These docs are indexed notes, but the
 * watcher's self-write guard returns BEFORE reindexing the app's own bytes, so a
 * caller that needs the derived index (documents row / notes_fts / note_links) to
 * reflect the write immediately must reindex the file afterward — see the
 * agent-tool path in `notes-write.ts` (`reindexFile(db, workspaceDocPath(...))`).
 * The IPC update path reindexes the whole workspace; the migration backfill is
 * followed by `reindexAllWorkspaces`.
 */
export function writeWorkspaceDoc(
  db: Database.Database,
  workspaceId: string,
  kind: WorkspaceDocKind,
  content: string
): void {
  const path = workspaceDocPath(db, workspaceId, kind)
  markSelfWrite(path, content)
  atomicWriteFile(path, content)
}

/**
 * Ensure both docs exist as EMPTY files. For each kind: if the workspace folder
 * exists AND the file is absent, create it blank. Never overwrites an existing
 * file. No-op when the workspace folder doesn't exist (never mkdir it back).
 */
export function ensureWorkspaceDocs(db: Database.Database, workspaceId: string): void {
  const dir = getWorkspaceVaultDir(db, workspaceId)
  if (!existsSync(dir)) return
  for (const kind of ['description', 'memory'] as WorkspaceDocKind[]) {
    const path = join(dir, fileForKind(kind))
    if (existsSync(path)) continue
    markSelfWrite(path, '')
    atomicWriteFile(path, '')
  }
}
