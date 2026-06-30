import type Database from 'better-sqlite3'
import { getWorkspaceVaultDir } from '../vault/paths'
import { getDocument } from '../vault/documents-service'
import {
  ensureRepo,
  commitPaths,
  commitAll,
  logForPath,
  logAll,
  readFileAtRef,
  diffForPath,
  diffBetweenRefs,
  AGENT_IDENTITY,
  APP_IDENTITY,
  type GitIdentity,
  type GitLogEntry
} from './git-service'

/**
 * Database-aware glue over the per-workspace git engine (`git-service.ts`). These
 * resolve a workspace's on-disk folder (and a document's backing file) so callers
 * work in app terms (workspaceId / documentId) while the engine stays purely
 * path-based. Follows the repo convention of `db` as the first argument.
 */

/** Initialize the git repo (+ managed `.gitignore`) for a workspace. Idempotent. */
export function ensureWorkspaceRepo(db: Database.Database, workspaceId: string): Promise<void> {
  return ensureRepo(getWorkspaceVaultDir(db, workspaceId))
}

/**
 * Commit the CURRENT on-disk state of a single document's backing file — the
 * before-agent-patch boundary (§4.5). MUST be awaited BEFORE the patch overwrites
 * the file, so the pre-edit bytes are what get captured. Attributed to the agent
 * identity so history can answer "what did the agent do" without parsing messages.
 * Returns the commit oid, or null if there was nothing dirty / no backing file.
 */
export async function commitDocumentPreImage(
  db: Database.Database,
  documentId: string,
  message: string
): Promise<string | null> {
  const doc = getDocument(db, documentId)
  if (!doc?.file_path) return null
  const dir = getWorkspaceVaultDir(db, doc.workspace_id)
  return commitPaths(dir, [doc.file_path], message, AGENT_IDENTITY)
}

/**
 * Commit ALL pending changes across a workspace — backs the agent turn-end safety
 * net (which captures built-in write/edit changes to notes that never went through
 * the propose_edit boundary) and manual named checkpoints. Returns the commit oid
 * or null if the worktree is clean.
 */
export function commitWorkspaceAll(
  db: Database.Database,
  workspaceId: string,
  message: string,
  identity: GitIdentity = APP_IDENTITY
): Promise<string | null> {
  return commitAll(getWorkspaceVaultDir(db, workspaceId), message, identity)
}

/** Agent turn-end safety-net commit, attributed to the agent identity. */
export function commitAgentTurn(
  db: Database.Database,
  workspaceId: string,
  message = 'agent: session changes'
): Promise<string | null> {
  return commitWorkspaceAll(db, workspaceId, message, AGENT_IDENTITY)
}

// ---------------------------------------------------------------------------
// read-only history accessors (back the agent's READ-ONLY git tools, Phase 3)
//
// These never mutate the repo, so they run without the per-repo serialization
// lock and tolerate an in-flight commit. All mutating git ops (commit, restore,
// revert) stay app-mediated — there is intentionally no db-aware mutating helper
// exposed for the agent.
// ---------------------------------------------------------------------------

/** Commits touching a single document's backing file, newest first. */
export function logDocumentHistory(
  db: Database.Database,
  documentId: string
): Promise<GitLogEntry[]> {
  const doc = getDocument(db, documentId)
  if (!doc?.file_path) return Promise.resolve([])
  return logForPath(getWorkspaceVaultDir(db, doc.workspace_id), doc.file_path)
}

/** The whole-workspace commit history (every checkpoint), newest first. */
export function logWorkspaceHistory(
  db: Database.Database,
  workspaceId: string
): Promise<GitLogEntry[]> {
  return logAll(getWorkspaceVaultDir(db, workspaceId))
}

/**
 * A document's backing-file bytes as they were at `ref`, or `null` if the document
 * is unknown / has no backing file / did not exist at that ref.
 */
export function showDocumentAtRef(
  db: Database.Database,
  documentId: string,
  ref: string
): Promise<string | null> {
  const doc = getDocument(db, documentId)
  if (!doc?.file_path) return Promise.resolve(null)
  return readFileAtRef(getWorkspaceVaultDir(db, doc.workspace_id), ref, doc.file_path)
}

/**
 * A unified text diff of a document between `fromRef` and either `toRef` (another
 * commit) or — when `toRef` is omitted — the CURRENT working-tree bytes. Returns
 * `''` when the document is unknown or has no backing file.
 */
export function diffDocument(
  db: Database.Database,
  documentId: string,
  fromRef: string,
  toRef?: string
): Promise<string> {
  const doc = getDocument(db, documentId)
  if (!doc?.file_path) return Promise.resolve('')
  const dir = getWorkspaceVaultDir(db, doc.workspace_id)
  return toRef
    ? diffBetweenRefs(dir, fromRef, toRef, doc.file_path)
    : diffForPath(dir, fromRef, doc.file_path)
}
