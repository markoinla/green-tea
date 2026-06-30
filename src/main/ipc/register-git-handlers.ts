import { existsSync } from 'fs'
import { ipcMain } from 'electron'
import * as documents from '../vault/documents-service'
import { getWorkspaceVaultDir } from '../vault/paths'
import {
  logForPath,
  logAll,
  diffForPath,
  restorePath,
  restoreVaultToCommit,
  type GitLogEntry,
  type VaultRestoreResult
} from '../git/git-service'
import { commitWorkspaceAll } from '../git/workspace-git'
import type { IpcHandlerContext } from './context'

/**
 * `git:*` IPC surface for the per-workspace git engine (Phase 1). All channels key
 * off a `documentId` (resolved to its backing file + owning workspace) so the
 * renderer's per-note history panel can stay in document terms:
 *  - `git:log`    — commits touching the note, newest first
 *  - `git:diff`   — unified text diff of the note at `ref` vs the working tree
 *  - `git:restore`— non-destructive restore of the note to `ref` (§4.7)
 *  - `git:checkpoint` — a manual, vault-wide named checkpoint
 *
 * Mutations are app-mediated only (never agent-driven). After a restore we
 * explicitly reindex the affected path and emit documents:content-changed /
 * documents:changed rather than relying on the debounced/lossy watcher.
 */
export function registerGitHandlers({ db, mainWindow }: IpcHandlerContext): void {
  ipcMain.handle('git:log', async (_event, documentId: string): Promise<GitLogEntry[]> => {
    const doc = documents.getDocument(db, documentId)
    if (!doc?.file_path) return []
    const dir = getWorkspaceVaultDir(db, doc.workspace_id)
    return logForPath(dir, doc.file_path)
  })

  ipcMain.handle('git:diff', async (_event, documentId: string, ref: string): Promise<string> => {
    const doc = documents.getDocument(db, documentId)
    if (!doc?.file_path) return ''
    const dir = getWorkspaceVaultDir(db, doc.workspace_id)
    return diffForPath(dir, ref, doc.file_path)
  })

  ipcMain.handle('git:restore', async (_event, documentId: string, ref: string) => {
    const doc = documents.getDocument(db, documentId)
    if (!doc?.file_path) throw new Error(`Document not found or has no backing file: ${documentId}`)
    const dir = getWorkspaceVaultDir(db, doc.workspace_id)

    // restorePath flushes the current state to git first (non-destructive, §4.7),
    // then writes the old bytes back (self-write-marked). The pre-restore state is
    // recoverable from that flush commit, so no separate snapshot is needed.
    const result = await restorePath(dir, ref, doc.file_path)

    // Drive the reindex + reload explicitly — the raw checkout bytes are written
    // through the self-write machinery, so the watcher will ignore them.
    documents.reindexFile(db, doc.file_path)
    mainWindow?.webContents.send('documents:content-changed', { id: doc.id })
    mainWindow?.webContents.send('documents:changed')
    return result
  })

  ipcMain.handle(
    'git:checkpoint',
    async (_event, workspaceId: string, message?: string): Promise<string | null> => {
      const label = message?.trim() || 'checkpoint'
      return commitWorkspaceAll(db, workspaceId, label)
    }
  )

  // Vault-level history (Phase 2, §6): whole-workspace commit list + a
  // non-destructive restore of the ENTIRE vault to a chosen commit.
  ipcMain.handle('git:vault-log', async (_event, workspaceId: string): Promise<GitLogEntry[]> => {
    return logAll(getWorkspaceVaultDir(db, workspaceId))
  })

  ipcMain.handle(
    'git:vault-restore',
    async (_event, workspaceId: string, ref: string): Promise<VaultRestoreResult> => {
      const dir = getWorkspaceVaultDir(db, workspaceId)
      // restoreVaultToCommit flushes the current whole-tree state to git first
      // (non-destructive, §4.7), then rewrites/removes every file that differs from
      // `ref`. The pre-restore state is recoverable from the returned flush commit.
      const result = await restoreVaultToCommit(dir, ref)

      // Drive the reindex + reload explicitly per affected path — the written bytes
      // are self-write-marked, so the watcher will ignore them (and it's lossy /
      // disabled on Linux anyway). Mirrors the per-note git:restore handler.
      for (const abs of result.restoredPaths) {
        if (existsSync(abs)) {
          const r = documents.reindexFile(db, abs)
          if (r.kind === 'created' || r.kind === 'updated') {
            mainWindow?.webContents.send('documents:content-changed', { id: r.docId })
          }
        } else {
          documents.deleteIndexRowByPath(db, abs)
        }
      }
      mainWindow?.webContents.send('documents:changed')
      return result
    }
  )
}
