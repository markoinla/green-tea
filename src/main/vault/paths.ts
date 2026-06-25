import type Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getAgentBaseDir, sanitizeWorkspaceName } from '../agent/paths'
import { getWorkspace } from '../database/repositories/workspaces'

/**
 * Vaults are durable note folders. They live in a dedicated `vaults/` directory
 * under the app base dir — deliberately NOT under `agent-workspace/`, which is a
 * sandbox-scoped scratch area that can be reset. One folder per workspace.
 *
 *   ~/Documents/Green Tea/vaults/<sanitized-workspace-name>/
 */

export function getVaultsRoot(db: Database.Database): string {
  return join(getAgentBaseDir(db), 'vaults')
}

/** Resolve (and create) the on-disk vault folder for a workspace. */
export function getWorkspaceVaultDir(db: Database.Database, workspaceId: string): string {
  const workspace = getWorkspace(db, workspaceId)
  const dirName = workspace ? sanitizeWorkspaceName(workspace.name) : workspaceId
  return join(getVaultsRoot(db), dirName)
}

export function ensureVaultDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
