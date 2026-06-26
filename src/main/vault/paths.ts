import type Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { join } from 'path'
import { getAgentBaseDir, getWorkspaceDir, getWorkspacesRoot } from '../agent/paths'

/**
 * A workspace *is* a folder anywhere on disk (`ws.path`) — notes at the root, a
 * hidden `.greentea/` for agent scratch. The directory layout is owned by
 * `agent/paths.ts`; this module just exposes the notes-facing names and the
 * one-time migration off the old `workspaces/` layout.
 */

/**
 * @deprecated There is no single root once workspaces have arbitrary paths. The
 * vault watcher now watches each workspace folder (`ws.path`) individually. This
 * remains only for the one-time legacy-layout migration and a couple of tests.
 */
export function getVaultsRoot(db: Database.Database): string {
  return getWorkspacesRoot(db)
}

/** Resolve the on-disk vault folder for a workspace. */
export function getWorkspaceVaultDir(db: Database.Database, workspaceId: string): string {
  return getWorkspaceDir(db, workspaceId)
}

export function ensureVaultDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Recursively move every file under `from` into `to`, creating directories as
 * needed and NEVER overwriting an existing target file. Used to merge a legacy
 * vault folder into an existing workspace folder file-by-file, so colliding
 * folders don't strand the notes that exist only in the legacy copy.
 */
function mergeMoveTree(from: string, to: string): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name)
    const dst = join(to, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(dst, { recursive: true })
      mergeMoveTree(src, dst)
    } else if (entry.isFile() && !existsSync(dst)) {
      renameSync(src, dst)
    }
  }
}

/**
 * One-time migration: durable notes used to live in `vaults/`, separate from the
 * agent's `agent-workspace/`. They now share a single `workspaces/` tree. Move
 * the old notes across non-destructively — a whole-tree rename when the target is
 * absent, else a per-FILE merge that never overwrites existing content (so a
 * colliding folder can't strand legacy-only notes). Idempotent: a no-op once
 * `vaults/` is gone. The disposable `agent-workspace/` scratch is intentionally
 * left behind (it rebuilds on demand).
 */
export function migrateLegacyVaultLayout(db: Database.Database): void {
  const base = getAgentBaseDir(db)
  const legacy = join(base, 'vaults')
  const current = getWorkspacesRoot(db)
  if (!existsSync(legacy)) return

  if (!existsSync(current)) {
    renameSync(legacy, current)
    return
  }

  for (const entry of readdirSync(legacy, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const from = join(legacy, entry.name)
    const to = join(current, entry.name)
    if (!existsSync(to)) {
      renameSync(from, to)
    } else {
      // Workspace folder already migrated: merge any legacy-only files in.
      mergeMoveTree(from, to)
    }
  }
}
