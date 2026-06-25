import type Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getSetting } from '../database/repositories/settings'
import { getWorkspace } from '../database/repositories/workspaces'

const DEFAULT_BASE_DIR = join(homedir(), 'Documents', 'Green Tea')

export function getAgentBaseDir(db: Database.Database): string {
  return getSetting(db, 'agentBaseDir') || DEFAULT_BASE_DIR
}

export function sanitizeWorkspaceName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'default'
  )
}

export function ensureUserDirs(db: Database.Database): void {
  const baseDir = getAgentBaseDir(db)
  for (const sub of ['skills', WORKSPACES_SUBDIR, 'agents']) {
    const dir = join(baseDir, sub)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

/**
 * Per-workspace folders live under a single `workspaces/` tree. Each one is the
 * durable home for that workspace's notes AND the agent's working area — the
 * notes sit at the folder root; the agent's scratch lives in a hidden `.agent/`
 * subfolder (see getAgentWorkDir) so it never clutters the note list.
 *
 *   ~/Documents/Green Tea/workspaces/<sanitized-workspace-name>/
 */
export const WORKSPACES_SUBDIR = 'workspaces'

/** Hidden subfolder (inside the workspace dir) for the agent's scratch files. */
const AGENT_SCRATCH_SUBDIR = '.agent'

export function getWorkspacesRoot(db: Database.Database): string {
  return join(getAgentBaseDir(db), WORKSPACES_SUBDIR)
}

/** Resolve the on-disk folder for a workspace (its notes vault + agent home). */
export function getWorkspaceDir(db: Database.Database, workspaceId?: string): string {
  const root = getWorkspacesRoot(db)
  if (!workspaceId) return join(root, 'default')
  const workspace = getWorkspace(db, workspaceId)
  const dirName = workspace ? sanitizeWorkspaceName(workspace.name) : workspaceId
  return join(root, dirName)
}

/** The agent's working directory: a hidden scratch folder inside the workspace. */
export function getAgentWorkDir(db: Database.Database, workspaceId?: string): string {
  return join(getWorkspaceDir(db, workspaceId), AGENT_SCRATCH_SUBDIR)
}
