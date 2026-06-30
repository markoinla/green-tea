import type Database from 'better-sqlite3'
import { getSettingsDir } from '../agent/paths'
import { ensureRepo, commitAll, APP_IDENTITY, type GitLogEntry, logAll } from './git-service'

/**
 * Global-config git repo (Phase 4, §4.1/§6). The SAME per-dir engine as the
 * per-workspace repos (`git-service.ts`), pointed at the consolidated hidden
 * `.settings/` folder so `skills/`, `plugins/`, `agents/`, `mcp.json`, and
 * `theme.json` get atomic version history — "version my skills/agents/mcp config"
 * nearly for free.
 *
 * This is a DISTINCT repo/unit: it is rooted at `.settings/`, never nested in or
 * merged with any workspace repo, and maps 1:1 to its own future Artifacts remote
 * ("my config follows me"). It shares the engine (serialization queue, identities,
 * non-destructive restore discipline) but nothing else.
 *
 * Post-Phase-00 the `.settings/` folder is config-only — the OAuth `*-auth/` dirs
 * were migrated into the encrypted secrets store and deleted — so NOTHING secret
 * lives here and the whole folder is safe to track.
 */

/**
 * Managed `.gitignore` for the `.settings/` repo. FLAT — no `!` negation, no nested
 * ignores (both trip isomorphic-git's matcher). Deliberately leaner than the
 * per-workspace ignore set: there are no notes/attachments/derived-DB here, only
 * config. We track everything under `.settings/` (skills/plugins/agents/mcp.json/
 * theme.json plus the `.seeded-defaults` markers and the migration audit manifest)
 * and ignore only OS junk and any stray dependency/log dirs a plugin might drop.
 */
export const SETTINGS_GITIGNORE_CONTENTS = `# Green Tea — managed global-config repo (git-backed versioning, Phase 4 §4.1).
# Flat list; no negation rules. Config-only folder — nothing secret lives here.
.DS_Store
node_modules/
*.log
`

/**
 * Initialize the global-config git repo (+ its config-only `.gitignore`) rooted at
 * `<base>/.settings/`. Idempotent and safe to call on every startup; serialized per
 * dir like every other repo op. Follows the repo convention of `db` as first arg.
 */
export function ensureSettingsRepo(db: Database.Database): Promise<void> {
  return ensureRepo(getSettingsDir(db), SETTINGS_GITIGNORE_CONTENTS)
}

/**
 * Commit the current on-disk state of the global config (whole-tree reconcile of
 * `.settings/`). Backs both the startup baseline ("initial import") and the
 * commit-on-config-change trigger (skills/plugins/agents/mcp.json/theme.json edits,
 * driven by the settings watcher). Returns the new commit oid, or `null` when the
 * config is unchanged vs HEAD (no empty commit is ever minted). Attributed to the
 * app identity — config edits are user/app actions, not agent patches.
 */
export function commitSettingsChange(
  db: Database.Database,
  message: string
): Promise<string | null> {
  return commitAll(getSettingsDir(db), message, APP_IDENTITY)
}

/** The global-config repo's commit history (every config checkpoint), newest first. */
export function logSettingsHistory(db: Database.Database): Promise<GitLogEntry[]> {
  return logAll(getSettingsDir(db))
}
