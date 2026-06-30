import type Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, sep } from 'path'
import { getAgentBaseDir, getSettingsDir, getWorkspaceDir, getWorkspacesRoot } from '../agent/paths'
import { findByPath, listWorkspaces, normalizePath } from '../database/repositories/workspaces'

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

/**
 * The five global-config items consolidated under `.settings/` (§4.2/§4.2.1).
 * The allowlist is closed: ONLY these names are ever moved, which structurally
 * guarantees workspaces, the (already-removed) `*-auth/` secret dirs, `.DS_Store`
 * and any unknown future item are never swept up.
 */
const SETTINGS_CONFIG_ITEMS = ['skills', 'plugins', 'agents', 'mcp.json', 'theme.json'] as const

/** The hardcoded default base the legacy `mcp.json` constructor used (§4.2.1). */
const LEGACY_HOME_BASE = join(homedir(), 'Documents', 'Green Tea')

/**
 * Source location for a config item BEFORE the `.settings/` move. Four items were
 * already base-aware (`<base>/<item>`), but `mcp.json` was historically hardcoded
 * to `<legacyHomeBase>/mcp.json` and ignored the `agentBaseDir` override (§4.2.1)
 * — so under an override its source is on a different volume. `legacyHomeBase` is
 * injectable so tests can point it at a temp dir instead of the real homedir.
 */
function legacyConfigSource(base: string, legacyHomeBase: string, name: string): string {
  if (name === 'mcp.json') return join(legacyHomeBase, 'mcp.json')
  return join(base, name)
}

/**
 * True if `source` is (or contains / is contained by) a folder registered as a
 * workspace. The allowlist keys on basename, but a user could legitimately have a
 * workspace whose folder basename is e.g. `skills` — we must never relocate that.
 */
function overlapsRegisteredWorkspace(db: Database.Database, source: string): boolean {
  if (findByPath(db, source)) return true
  const target = normalizePath(source)
  for (const w of listWorkspaces(db)) {
    if (!w.path) continue
    const existing = normalizePath(w.path)
    if (
      existing === target ||
      target.startsWith(existing + sep) ||
      existing.startsWith(target + sep)
    ) {
      return true
    }
  }
  return false
}

/**
 * Move a single file non-destructively. `renameSync` is atomic within a volume;
 * if the source and destination are on different volumes (possible for the
 * homedir-sourced `mcp.json` under an `agentBaseDir` override) `renameSync` throws
 * EXDEV, so fall back to copy + unlink.
 */
function moveFileAcrossVolumes(source: string, dest: string): void {
  try {
    renameSync(source, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      copyFileSync(source, dest)
      unlinkSync(source)
    } else {
      throw err
    }
  }
}

/**
 * Relocate one allowlisted config item from its legacy location into `.settings/`.
 * Per-item, NON-DESTRUCTIVE and idempotent with NO global flag (mirrors
 * migrateLegacyVaultLayout): when the source is gone and the destination is
 * present the item is already done, so this is self-healing and can never strand a
 * skipped item on a flag. When the destination is absent it's a whole-tree/whole-
 * file move; when it already exists (a partial/re-run) a dir is merged file-by-file
 * NEVER overwriting, and a file is left as-is (destination wins).
 */
function migrateConfigItem(db: Database.Database, source: string, dest: string, isDir: boolean): void {
  if (!existsSync(source)) return // already moved (or never existed) — idempotent no-op
  // Never sweep up a registered workspace that happens to share a config basename.
  if (overlapsRegisteredWorkspace(db, source)) {
    console.warn('[migration] skipping config move; source is a registered workspace:', source)
    return
  }
  mkdirSync(dirname(dest), { recursive: true }) // ensure `.settings/` exists
  if (!existsSync(dest)) {
    if (isDir) {
      // Same-volume (both under base) — atomic whole-tree rename.
      renameSync(source, dest)
    } else {
      moveFileAcrossVolumes(source, dest)
    }
    return
  }
  // Destination already exists (partial run / second launch). Never overwrite.
  if (isDir) {
    mergeMoveTree(source, dest)
  }
}

/**
 * One-time migration (§6 Phase 0): consolidate the five global-config items
 * {skills, plugins, agents, mcp.json, theme.json} under `<base>/.settings/`,
 * reading each from its ACTUAL current location (base-aware vs the hardcoded
 * homedir `mcp.json`). Allowlist-only, per-item, non-destructive, idempotent with
 * NO global one-shot flag — every item self-checks via existsSync each run, so a
 * partial move heals on the next launch and a skipped item is never stranded.
 *
 * MUST run BEFORE ensureUserDirs and the seed/ensure/load passes (see index.ts):
 * those create the `.settings/<item>` destinations, so running this first keeps
 * destinations absent and takes the atomic whole-tree rename path rather than the
 * never-overwrite merge path.
 *
 * `legacyHomeBase` is the hardcoded base the old `mcp.json` constructor used; it
 * defaults to the real homedir location and is a parameter ONLY so tests can
 * redirect it to a temp dir (never touching a real `~/Documents/Green Tea`).
 */
export function migrateGlobalConfigToSettings(
  db: Database.Database,
  legacyHomeBase: string = LEGACY_HOME_BASE
): void {
  const base = getAgentBaseDir(db)
  const settingsDir = getSettingsDir(db)
  for (const name of SETTINGS_CONFIG_ITEMS) {
    const source = legacyConfigSource(base, legacyHomeBase, name)
    const dest = join(settingsDir, name)
    const isDir = name !== 'mcp.json' && name !== 'theme.json'
    try {
      migrateConfigItem(db, source, dest, isDir)
    } catch (err) {
      // Per-item guard: one bad item never blocks the others or startup; a later
      // launch retries it (no flag was set), self-healing toward completion.
      console.error('[migration] config item move failed:', name, err)
    }
  }
}
