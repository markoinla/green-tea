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
  for (const sub of ['skills', 'agent-workspace', 'agents']) {
    const dir = join(baseDir, sub)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

export function getAgentWorkDir(db: Database.Database, workspaceId?: string): string {
  const baseDir = getAgentBaseDir(db)
  if (!workspaceId) return join(baseDir, 'agent-workspace', 'default')
  const workspace = getWorkspace(db, workspaceId)
  const dirName = workspace ? sanitizeWorkspaceName(workspace.name) : workspaceId
  return join(baseDir, 'agent-workspace', dirName)
}
