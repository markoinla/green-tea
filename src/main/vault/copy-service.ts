import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { basename, extname, join, sep } from 'path'
import { sanitizeWorkspaceName } from '../agent/paths'
import { getWorkspaceVaultDir, ensureVaultDir } from './paths'
import { readNote, uniqueNotePath, writeNote } from './note-store'

/**
 * "Copy to workspace": duplicate a note/artifact file or a whole folder subtree
 * from one workspace into another (or into a different folder of the same one).
 * Files are the source of truth, so this is mostly a filesystem copy — the caller
 * reindexes the TARGET workspace afterwards so the derived index/tree pick up the
 * new files (collision-safe filenames). Nothing here touches the DB.
 *
 * Notes (`.md`) are NOT byte-copied: they carry their identity in frontmatter
 * `id`, and documents.id is a global primary key, so a copy sharing its source's
 * id would make the target reindex's `ON CONFLICT(id)` upsert overwrite the
 * source's row (orphaning it, or flipping its workspace/file_path). So every
 * copied note is re-stamped with a fresh id (see copyNote). Artifacts keep their
 * bytes — their identity is path-derived, so a copy is already a distinct id.
 */

export type CopyToWorkspaceParams = {
  kind: 'document' | 'folder'
  // 'copy' duplicates the item; 'move' copies it and then deletes the source (the
  // caller performs the delete after this filesystem copy). Defaults to 'copy'.
  mode?: 'copy' | 'move'
  documentId?: string // required when kind === 'document'
  sourceWorkspaceId?: string // required when kind === 'folder'
  folderName?: string // required when kind === 'folder' (folder DB 'name', a relative slash-path)
  folderId?: string // required when kind === 'folder' && mode === 'move' (source folder to delete)
  targetWorkspaceId: string
  targetFolder: string // destination folder DB 'name'; '' means workspace root
}

// A folder "name" may be a multi-segment POSIX path (e.g. "A/B"). Sanitize each
// segment but preserve the hierarchy so the on-disk directory is the exact
// inverse of the folder row — identical to the private helper in
// documents-service (kept in sync). An empty name resolves to the vault root.
function folderSubdir(name: string): string {
  if (name === '') return ''
  return name
    .split('/')
    .map((segment) => sanitizeWorkspaceName(segment))
    .join(sep)
}

/** Resolve (and create) the destination directory for a (workspace, folder). */
function resolveDestDir(db: Database.Database, workspaceId: string, folder: string): string {
  const vault = ensureVaultDir(getWorkspaceVaultDir(db, workspaceId))
  const sub = folderSubdir(folder)
  return ensureVaultDir(sub ? join(vault, sub) : vault)
}

/** Pick a unique `<stem><ext>` within a directory, preserving the file's extension. */
function uniqueArtifactPath(dir: string, stem: string, ext: string): string {
  let candidate = join(dir, `${stem}${ext}`)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem} ${n}${ext}`)
    n++
  }
  return candidate
}

/** Pick a unique subdirectory name within a parent (append ` 2`, ` 3`, ...). */
function uniqueDirPath(parent: string, name: string): string {
  let candidate = join(parent, name)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(parent, `${name} ${n}`)
    n++
  }
  return candidate
}

/**
 * Copy a `.md` note by re-stamping a fresh identity, so the copy never shares its
 * `id` with the source (documents.id is a global primary key; a shared id makes
 * the target reindex's upsert overwrite the source's row). Read WITHOUT persisting
 * a backfill so the source file is never mutated, swap in a new id + timestamps,
 * and atomic-write via the note store to the (already collision-safe) destination.
 */
function copyNote(source: string, destFile: string): void {
  const note = readNote(source, false)
  const now = new Date().toISOString()
  const frontmatter = { ...note.frontmatter, id: randomUUID(), created: now, updated: now }
  writeNote(destFile, { frontmatter, doc: note.doc })
}

/**
 * Recursively copy every file under `from` into `to`, creating directories as
 * needed and NEVER overwriting an existing target file. Notes are re-stamped with
 * a fresh id (copyNote); every other file is byte-copied. Returns the number of
 * files copied. Symlinks and non-regular entries are skipped.
 */
function copyTree(from: string, to: string): number {
  mkdirSync(to, { recursive: true })
  let count = 0
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name)
    const dst = join(to, entry.name)
    if (entry.isDirectory()) {
      count += copyTree(src, dst)
    } else if (entry.isFile() && !existsSync(dst)) {
      if (extname(entry.name).toLowerCase() === '.md') {
        copyNote(src, dst)
      } else {
        copyFileSync(src, dst)
      }
      count++
    }
  }
  return count
}

/** Copy a table-schema sidecar (`<file>.meta.json`) alongside its host, if present. */
function copySidecar(sourceFile: string, destFile: string): void {
  const sidecar = `${sourceFile}.meta.json`
  if (existsSync(sidecar)) {
    const dstSidecar = `${destFile}.meta.json`
    if (!existsSync(dstSidecar)) copyFileSync(sidecar, dstSidecar)
  }
}

function copyDocument(db: Database.Database, params: CopyToWorkspaceParams): number {
  const { documentId, targetWorkspaceId, targetFolder } = params
  if (!documentId) throw new Error('documentId is required to copy a document')

  const row = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(documentId) as
    | { file_path: string | null }
    | undefined
  if (!row) throw new Error(`Document not found: ${documentId}`)
  const source = row.file_path
  if (!source || !existsSync(source)) {
    throw new Error(`Document has no file on disk: ${documentId}`)
  }

  const destDir = resolveDestDir(db, targetWorkspaceId, targetFolder)
  const ext = extname(source)
  const stem = basename(source, ext)

  // Notes get `.md` collision handling and are re-stamped with a fresh id (never
  // byte-copied, so the copy can't collide with the source's index row). Every
  // other artifact keeps its own ext and bytes (path-derived identity, no sidecar
  // concern for notes).
  if (ext.toLowerCase() === '.md') {
    copyNote(source, uniqueNotePath(destDir, stem))
    return 1
  }

  const destFile = uniqueArtifactPath(destDir, stem, ext)
  copyFileSync(source, destFile)
  copySidecar(source, destFile)
  return 1
}

function copyFolder(db: Database.Database, params: CopyToWorkspaceParams): number {
  const { sourceWorkspaceId, folderName, targetWorkspaceId, targetFolder } = params
  if (!sourceWorkspaceId) throw new Error('sourceWorkspaceId is required to copy a folder')
  if (folderName === undefined || folderName === '') {
    throw new Error('folderName is required to copy a folder')
  }

  const sourceVault = getWorkspaceVaultDir(db, sourceWorkspaceId)
  const sourceDir = join(sourceVault, folderSubdir(folderName))
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`Source folder not found: ${folderName}`)
  }

  const destParent = resolveDestDir(db, targetWorkspaceId, targetFolder)

  // Guard against copying a folder into itself or one of its own descendants,
  // which would otherwise recurse forever (only possible within one workspace).
  const src = sourceDir.normalize('NFC')
  const parent = destParent.normalize('NFC')
  if (parent === src || parent.startsWith(src + sep)) {
    throw new Error('Cannot copy a folder into itself or one of its descendants')
  }

  // Collision-safe at the top-level directory name (basename of the folder path).
  const topName = basename(folderSubdir(folderName))
  const destDir = uniqueDirPath(destParent, topName)
  return copyTree(sourceDir, destDir)
}

/**
 * Copy a single document or a whole folder subtree into a target workspace/folder.
 * Returns the number of files copied. Filesystem-only; the caller reindexes the
 * target workspace and broadcasts the change events.
 */
export function copyItemToWorkspace(
  db: Database.Database,
  params: CopyToWorkspaceParams
): { createdCount: number } {
  const createdCount = params.kind === 'folder' ? copyFolder(db, params) : copyDocument(db, params)
  return { createdCount }
}
