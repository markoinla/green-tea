import type Database from 'better-sqlite3'
import { app } from 'electron'
import { cpSync, existsSync } from 'fs'
import { join } from 'path'
import { reindexWorkspace } from '../vault/documents-service'
import { ensureVaultDir, getWorkspaceVaultDir } from '../vault/paths'
import { listWorkspaces } from './repositories/workspaces'

/**
 * Locate the bundled default-workspace seed content. In production it sits at
 * `process.resourcesPath/default-workspace` (see `extraResources` in
 * electron-builder.yml); in dev it's `<project>/resources/default-workspace`.
 * Mirrors the skills/plugins resource-dir helpers.
 */
function getDefaultWorkspaceResourceDir(): string {
  const prodPath = join(process.resourcesPath, 'default-workspace')
  if (existsSync(prodPath)) return prodPath
  return join(app.getAppPath(), 'resources', 'default-workspace')
}

/**
 * Seed starter content into the default workspace on a FRESH install only.
 *
 * Guarded to be a no-op unless the vault is empty (any existing document → bail,
 * so this never re-plants once the user has notes) and a workspace exists. It
 * copies the bundled `resources/default-workspace/` tree — plain `.md` notes plus
 * artifacts (`.csv`, `.excalidraw`, images, `.pdf`, …) and any subfolders — into
 * the workspace folder, then reindexes so the files appear in the tree this
 * launch. The copied files are ordinary editable files on disk; markdown notes
 * get their id/frontmatter backfilled by the indexer on first read.
 *
 * The recursive copy force-overwrites the empty `README.md` and `MEMORY.md` that
 * `ensureWorkspaceDocs` plants just before this runs, replacing them with the
 * shipped seed versions.
 */
export function seedDefaultWorkspace(db: Database.Database): void {
  const docCount = db.prepare('SELECT COUNT(*) as cnt FROM documents').get() as { cnt: number }
  if (docCount.cnt > 0) return

  const workspaces = listWorkspaces(db)
  if (workspaces.length === 0) return

  const sourceDir = getDefaultWorkspaceResourceDir()
  if (!existsSync(sourceDir)) return

  const workspaceId = workspaces[0].id
  const destDir = ensureVaultDir(getWorkspaceVaultDir(db, workspaceId))

  // Copy the bundled starter tree into the workspace folder. Recursive so
  // subfolders become tree folders; contents land directly under the workspace
  // dir. Written outside the note-store, so rebuild this workspace's index from
  // disk afterward to surface them (and mint ids/frontmatter for the seed notes).
  cpSync(sourceDir, destDir, { recursive: true })
  reindexWorkspace(db, workspaceId)
}
