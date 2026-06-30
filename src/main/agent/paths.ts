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

/** Hidden folder name (under the base dir) holding consolidated global config. */
export const SETTINGS_SUBDIR = '.settings'

/**
 * The hidden `.settings/` folder under the base dir that holds all consolidated
 * global config/extensions (skills/, plugins/, agents/, mcp.json, theme.json).
 * Single helper consumed by every config path constructor so the watched dir and
 * the read path can never drift (§4.2). Its own future git repo (§4.1).
 */
export function getSettingsDir(db: Database.Database): string {
  return join(getAgentBaseDir(db), SETTINGS_SUBDIR)
}

/**
 * Names a workspace folder may NOT take, so a user-created workspace can never
 * collide with app-managed global config — the hidden config folders themselves
 * (`.settings`, `.greentea`, legacy `workspaces`) or a config item now living
 * under `.settings/` (skills/plugins/agents/mcp.json/theme.json). Compared
 * case-insensitively (default macOS is case-insensitive). See assertNoOverlap for
 * the path-level guard at workspace creation.
 */
export const RESERVED_WORKSPACE_NAMES = new Set([
  '.settings',
  '.greentea',
  'workspaces',
  'skills',
  'plugins',
  'agents',
  'mcp.json',
  'theme.json'
])

export function sanitizeWorkspaceName(name: string): string {
  const sanitized =
    name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'default'
  // Reserve app-managed names: a workspace folder named e.g. ".settings" or
  // "skills" would collide with global config, so suffix it to disambiguate.
  if (RESERVED_WORKSPACE_NAMES.has(sanitized.toLowerCase())) {
    return `${sanitized}_`
  }
  return sanitized
}

export function ensureUserDirs(db: Database.Database): void {
  const settingsDir = getSettingsDir(db)
  // Only the global, shared siblings are app-managed now, all consolidated under
  // the hidden `.settings/` folder (§4.2). Workspace folders are arbitrary
  // user-chosen paths (or default-location folders) created on demand.
  for (const sub of ['skills', 'agents']) {
    const dir = join(settingsDir, sub)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

/**
 * A workspace *is* a folder anywhere on disk (Obsidian-style). The folder is
 * flat — its whole tree is the document set (`.md` notes plus `.html`/`.csv`
 * artifacts) — with a single hidden `.greentea/` dir for agent scratch. The
 * path is recorded on the workspace row (`ws.path`); see getWorkspaceDir.
 *
 * Default-location workspaces sit directly under the global base:
 *   ~/Documents/Green Tea/<sanitized-workspace-name>/
 * The global config (skills/, plugins/, agents/, mcp.json, theme.json) is
 * consolidated under the hidden `.settings/` sibling, shared across workspaces.
 */

/** Hidden subfolder (inside the workspace dir) for the agent's scratch files. */
const AGENT_SCRATCH_SUBDIR = '.greentea'

/**
 * @deprecated Legacy app-managed `workspaces/` subdir. Workspaces now record an
 * arbitrary `ws.path`, so there is no single root for all of them. Retained only
 * for the one-time legacy-layout migration and the watcher until Phase 4 moves
 * the watcher to per-workspace paths.
 */
export const WORKSPACES_SUBDIR = 'workspaces'

/** @deprecated See WORKSPACES_SUBDIR — no single root once paths are arbitrary. */
export function getWorkspacesRoot(db: Database.Database): string {
  return join(getAgentBaseDir(db), WORKSPACES_SUBDIR)
}

/**
 * The default on-disk location for a workspace whose folder wasn't explicitly
 * picked: `~/Documents/Green Tea/<sanitized-name>/`, a flat sibling of the global
 * `skills/` and `mcp.json`.
 */
export function getDefaultWorkspaceDir(db: Database.Database, name: string): string {
  return join(getAgentBaseDir(db), sanitizeWorkspaceName(name))
}

/**
 * Resolve the on-disk folder for a workspace (its notes + agent home). Returns
 * the stored `ws.path` directly (the arbitrary user-chosen folder). Falls back to
 * the default location derived from the workspace name only when `path` is unset
 * (legacy rows before backfill, or a missing workspace).
 */
export function getWorkspaceDir(db: Database.Database, workspaceId?: string): string {
  if (!workspaceId) return getDefaultWorkspaceDir(db, 'default')
  const workspace = getWorkspace(db, workspaceId)
  if (workspace?.path) return workspace.path
  return getDefaultWorkspaceDir(db, workspace ? workspace.name : workspaceId)
}

/** The agent's working directory: a hidden scratch folder inside the workspace. */
export function getAgentWorkDir(db: Database.Database, workspaceId?: string): string {
  return join(getWorkspaceDir(db, workspaceId), AGENT_SCRATCH_SUBDIR)
}
