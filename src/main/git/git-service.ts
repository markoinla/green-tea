import * as fs from 'fs'
import { existsSync } from 'fs'
import { join, relative, sep } from 'path'
import git from 'isomorphic-git'
import { createTwoFilesPatch } from 'diff'
import { atomicWriteFile } from '../vault/note-store'
import { markSelfWrite } from '../vault/self-write'

/**
 * Per-workspace git engine (Phase 1, §4.4/§4.6/§4.7/§5). A thin, app-mediated
 * wrapper over `isomorphic-git` (pure JS — no system `git` binary) that gives the
 * whole workspace folder atomic, cross-file version history: checkpoints, diffs,
 * and non-destructive restore.
 *
 * Hard rules this module enforces:
 *  - Committing writes ONLY under `.git/` (which the vault-watcher ignores), so a
 *    commit never trips a reindex/reload (§5).
 *  - All MUTATING ops (ensureRepo, commit*, restore) are serialized per repo dir
 *    through an async queue, because isomorphic-git does no `.git/index` locking
 *    and the three commit triggers (debounced autosave, before-agent-patch, manual
 *    checkpoint) can otherwise race and corrupt the index. Read-only ops
 *    (logForPath, diffForPath) run concurrently and tolerate an in-flight commit.
 *  - Restore is NEVER destructive: the current on-disk state is committed/flushed
 *    first, then the old bytes are written (§4.7).
 *  - Distinct commit identities for agent-driven vs app/manual commits so history
 *    can attribute "what the agent did" without parsing messages.
 *
 * The `document_versions` per-note quick-undo layer is intentionally kept intact
 * and untouched — git sits at a different altitude (vault-wide checkpoints).
 */

/** App/manual/autosave commits (debounced autosave, manual checkpoints, restore flush). */
export const APP_IDENTITY = { name: 'Green Tea', email: 'noreply@greentea.app' } as const
/** Commits made on the agent-patch boundary, so `git log` attributes them to the agent. */
export const AGENT_IDENTITY = { name: 'Green Tea Agent', email: 'agent@greentea.app' } as const

export type GitIdentity = { name: string; email: string }

export interface GitLogEntry {
  oid: string
  message: string
  authorName: string
  authorEmail: string
  /** Commit time in epoch milliseconds. */
  timestamp: number
}

/**
 * Managed `.gitignore` (§4.6). FLAT — no `!` negation and no nested ignores, both
 * of which trip isomorphic-git's matcher. Reconciled with the vault-watcher /
 * note-store ignore set (`.git`, `.obsidian`, `node_modules`, `attachments`,
 * `.trash`): binary media under `attachments/` is IGNORED for v1 (isomorphic-git
 * writes only loose zlib objects — no packfile/delta/gc — so tracking every media
 * revision would grow `.git` unbounded). The derived SQLite index lives in
 * userData, not the vault, but its patterns are listed defensively.
 */
const GITIGNORE_CONTENTS = `# Green Tea — managed (git-backed versioning, §4.6). Flat list; no negation rules.
.greentea/
.obsidian/
.trash/
.DS_Store
node_modules/
attachments/
*.sqlite
*.sqlite-shm
*.sqlite-wal
*.db
*.db-shm
*.db-wal
`

// ---------------------------------------------------------------------------
// per-repo serialization (async mutex keyed by repo dir)
// ---------------------------------------------------------------------------

const repoQueues = new Map<string, Promise<unknown>>()

/**
 * Per-repo `.gitignore` override, registered by `ensureRepo(dir, contents)`. Lets a
 * distinct repo (e.g. the Phase 4 global-config repo rooted at `.settings/`) ship a
 * different ignore set than the per-workspace default while reusing all the same
 * machinery. Looked up by the internal commit/restore paths too, so a re-created
 * `.gitignore` (deleted then a commit fires) is rewritten with the RIGHT contents
 * for that repo rather than the workspace default.
 */
const gitignoreByRepo = new Map<string, string>()

function repoKey(dir: string): string {
  return dir.normalize('NFC')
}

/**
 * Run `fn` after every previously-enqueued mutating op for `dir` has settled,
 * funneling all writers for one repo through a single promise chain. The chain
 * advances regardless of whether a prior op resolved or rejected, so one failure
 * never wedges the queue.
 */
function enqueue<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const key = repoKey(dir)
  const prev = repoQueues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  // Store a non-rejecting tail so the next enqueue doesn't inherit a rejection.
  repoQueues.set(
    key,
    next.then(
      () => undefined,
      () => undefined
    )
  )
  return next
}

// ---------------------------------------------------------------------------
// path helpers
// ---------------------------------------------------------------------------

/** Convert an absolute vault path to a repo-relative POSIX path (git's filepath). */
function toRepoRel(dir: string, absPath: string): string {
  return relative(dir, absPath).split(sep).join('/')
}

// ---------------------------------------------------------------------------
// ensureRepo
// ---------------------------------------------------------------------------

async function ensureRepoUnlocked(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    // Never mkdir a workspace folder into existence here — an absent folder is an
    // "unavailable" workspace and must stay untouched.
    return
  }
  const gitDir = join(dir, '.git')
  if (!existsSync(gitDir)) {
    await git.init({ fs, dir, defaultBranch: 'main' })
    // Belt-and-suspenders identity: every commit also passes an explicit author,
    // but a configured user lets any stray isomorphic-git path that reads config
    // succeed on a freshly-init'd repo.
    await git.setConfig({ fs, dir, path: 'user.name', value: APP_IDENTITY.name })
    await git.setConfig({ fs, dir, path: 'user.email', value: APP_IDENTITY.email })
  }
  const gitignorePath = join(dir, '.gitignore')
  if (!existsSync(gitignorePath)) {
    // Use the per-repo override if one was registered (e.g. the .settings/ config
    // repo), else the per-workspace default. `.gitignore` is a tracked file, so
    // mark the self-write to keep the watcher from echo-looping on it.
    const contents = gitignoreByRepo.get(repoKey(dir)) ?? GITIGNORE_CONTENTS
    markSelfWrite(gitignorePath, contents)
    atomicWriteFile(gitignorePath, contents)
  }
}

/**
 * Initialize a git repo in `dir` if absent and ensure a managed `.gitignore`
 * exists. Idempotent and safe to call on every workspace open. Serialized with
 * commits/restores for the same dir.
 *
 * `gitignoreContents` overrides the per-workspace default ignore set for THIS repo
 * dir (registered so the internal commit/restore `ensureRepo` calls reuse it too).
 * Used by the global-config repo (`.settings/`, Phase 4), which is config-only and
 * wants a different — flat — ignore list. The override never overwrites an
 * already-present `.gitignore`.
 */
export function ensureRepo(dir: string, gitignoreContents?: string): Promise<void> {
  if (gitignoreContents !== undefined) gitignoreByRepo.set(repoKey(dir), gitignoreContents)
  return enqueue(dir, () => ensureRepoUnlocked(dir))
}

// ---------------------------------------------------------------------------
// staging + commit
// ---------------------------------------------------------------------------

/**
 * Stage the given repo-relative paths into the index by CONTENT and report whether
 * anything actually changed versus HEAD. `git.add` is used for a file present on
 * disk (it re-reads + re-hashes the bytes fresh), `git.remove` for one that's gone
 * (git.add does NOT stage deletions; a rename surfaces as remove+add across the two
 * paths). `filepaths === undefined` stages the WHOLE worktree (full checkpoints /
 * the agent turn-end net); a scoped list backs the correctness-critical
 * before-agent-patch boundary.
 *
 * Two stat-cache hazards are sidestepped:
 *  1. We never use statusMatrix's WORKDIR verdict to decide WHAT to stage — it
 *     short-circuits on the index stat-cache and reports a same-mtime content
 *     change (rapid agent edits / autosaves land in the same wall-clock second) as
 *     UNMODIFIED, which would silently drop real edits. git.add always re-hashes.
 *  2. Change detection then reads the STAGE-vs-HEAD columns of statusMatrix, which
 *     are derived from the (freshly git.add-ed) index and the HEAD tree — NOT the
 *     stat-cache — so they are reliable.
 */
async function stageAndDetect(dir: string, filepaths?: string[]): Promise<boolean> {
  let paths = filepaths
  if (!paths) {
    // Whole-worktree: enumerate the file universe (HEAD ∪ index ∪ worktree,
    // .gitignore-respecting for untracked) — only the path column is used.
    const pre = await git.statusMatrix({ fs, dir })
    paths = pre.map((row) => row[0])
  }
  for (const filepath of paths) {
    if (existsSync(join(dir, filepath))) {
      await git.add({ fs, dir, filepath })
    } else {
      try {
        await git.remove({ fs, dir, filepath })
      } catch {
        // Untracked-and-absent: nothing to remove.
      }
    }
  }
  const post = await git.statusMatrix(
    filepaths && filepaths.length > 0 ? { fs, dir, filepaths } : { fs, dir }
  )
  for (const [, head, , stage] of post) {
    // Row codes — HEAD: 0 absent / 1 present; STAGE: 0 absent / 1 == HEAD /
    // 2|3 differs from HEAD. A staged change is anything that isn't "present and
    // identical to HEAD" or "absent in both".
    if ((head === 1 && stage !== 1) || (head === 0 && stage !== 0)) return true
  }
  return false
}

async function commitUnlocked(
  dir: string,
  filepaths: string[] | undefined,
  message: string,
  identity: GitIdentity
): Promise<string | null> {
  await ensureRepoUnlocked(dir)
  if (!existsSync(join(dir, '.git'))) return null // unavailable workspace — nothing to commit
  const changed = await stageAndDetect(dir, filepaths)
  if (!changed) return null // no real change — never mint an empty commit
  const now = Math.floor(Date.now() / 1000)
  const author = {
    name: identity.name,
    email: identity.email,
    timestamp: now,
    timezoneOffset: new Date().getTimezoneOffset()
  }
  return git.commit({ fs, dir, message, author, committer: author })
}

/**
 * Commit the current on-disk state of the given absolute `paths` (scoped staging).
 * Backs the before-agent-patch boundary and per-note flushes. Returns the new
 * commit oid, or `null` when there was nothing to commit. Serialized per dir.
 */
export function commitPaths(
  dir: string,
  paths: string[],
  message: string,
  identity: GitIdentity = APP_IDENTITY
): Promise<string | null> {
  const rel = paths.map((p) => toRepoRel(dir, p))
  return enqueue(dir, () => commitUnlocked(dir, rel, message, identity))
}

/**
 * Commit ALL pending changes in the worktree (whole-tree reconcile). Backs manual
 * checkpoints and the agent turn-end safety net (which captures built-in
 * write/edit changes that never went through the propose_edit boundary). Returns
 * the new commit oid, or `null` when the worktree is clean. Serialized per dir.
 */
export function commitAll(
  dir: string,
  message: string,
  identity: GitIdentity = APP_IDENTITY
): Promise<string | null> {
  return enqueue(dir, () => commitUnlocked(dir, undefined, message, identity))
}

// ---------------------------------------------------------------------------
// read-only: log + diff
// ---------------------------------------------------------------------------

/**
 * The commits that touched `absFilepath`, newest first. Read-only — runs without
 * the per-repo lock and tolerates an in-flight commit. Returns `[]` when the repo
 * doesn't exist yet or the path has no history.
 */
export async function logForPath(dir: string, absFilepath: string): Promise<GitLogEntry[]> {
  if (!existsSync(join(dir, '.git'))) return []
  const filepath = toRepoRel(dir, absFilepath)
  let commits: Awaited<ReturnType<typeof git.log>>
  try {
    commits = await git.log({ fs, dir, filepath, force: true })
  } catch {
    // No commits yet (unborn HEAD) or the path never existed.
    return []
  }
  return commits.map((c) => ({
    oid: c.oid,
    // isomorphic-git appends a trailing newline to stored messages; trim it so
    // the renderer gets the clean checkpoint label.
    message: c.commit.message.trimEnd(),
    authorName: c.commit.author.name,
    authorEmail: c.commit.author.email,
    timestamp: c.commit.author.timestamp * 1000
  }))
}

/**
 * The whole-repo commit history (every checkpoint/commit across the vault),
 * newest first. Backs the vault-level history view (Phase 2, §6). Read-only — runs
 * without the per-repo lock and tolerates an in-flight commit. Returns `[]` when
 * the repo doesn't exist yet or has no commits.
 */
export async function logAll(dir: string): Promise<GitLogEntry[]> {
  if (!existsSync(join(dir, '.git'))) return []
  let commits: Awaited<ReturnType<typeof git.log>>
  try {
    commits = await git.log({ fs, dir })
  } catch {
    return [] // unborn HEAD — no commits yet
  }
  return commits.map((c) => ({
    oid: c.oid,
    message: c.commit.message.trimEnd(),
    authorName: c.commit.author.name,
    authorEmail: c.commit.author.email,
    timestamp: c.commit.author.timestamp * 1000
  }))
}

/**
 * Resolve a user/agent-supplied `ref` to a concrete commit oid. `git.readBlob`'s
 * `oid` parameter does NOT accept symbolic refs (`HEAD`, branch names) — only a
 * real (or abbreviated) oid — so symbolic refs are resolved first via resolveRef,
 * then abbreviated oids are expanded; a full oid passes straight through.
 */
async function resolveRefToOid(dir: string, ref: string): Promise<string> {
  try {
    return await git.resolveRef({ fs, dir, ref })
  } catch {
    // Not a symbolic ref — try treating it as a (possibly abbreviated) oid.
  }
  try {
    return await git.expandOid({ fs, dir, oid: ref })
  } catch {
    return ref
  }
}

/** Read a file's bytes as they were at `ref`, or `null` if it didn't exist there. */
export async function readFileAtRef(
  dir: string,
  ref: string,
  absFilepath: string
): Promise<string | null> {
  const filepath = toRepoRel(dir, absFilepath)
  try {
    const oid = await resolveRefToOid(dir, ref)
    const { blob } = await git.readBlob({ fs, dir, oid, filepath })
    return Buffer.from(blob).toString('utf-8')
  } catch {
    return null
  }
}

/**
 * A unified text diff of `absFilepath` between `ref` (old) and the CURRENT on-disk
 * bytes (new). isomorphic-git has no `diff()` API, so this is built by hand from
 * `readBlob(ref)` + the worktree file, formatted with the `diff` package. A path
 * absent at `ref` (added) or absent now (deleted) diffs against an empty side.
 * Read-only.
 */
export async function diffForPath(dir: string, ref: string, absFilepath: string): Promise<string> {
  const filepath = toRepoRel(dir, absFilepath)
  const oldText = (await readFileAtRef(dir, ref, absFilepath)) ?? ''
  let newText = ''
  try {
    if (existsSync(absFilepath)) newText = fs.readFileSync(absFilepath, 'utf-8')
  } catch {
    newText = ''
  }
  return createTwoFilesPatch(
    filepath,
    filepath,
    oldText,
    newText,
    `${ref.slice(0, 8)}`,
    'working tree'
  )
}

/**
 * A unified text diff of `absFilepath` between two commits, `fromRef` (old) and
 * `toRef` (new). isomorphic-git has no `diff()` API, so this is built by hand from
 * `readBlob(fromRef)` + `readBlob(toRef)`, formatted with the `diff` package. A
 * path absent at either ref (added/deleted between the two) diffs against an empty
 * side. Read-only — backs the agent's `notes_git_diff` "diff this note across two
 * revisions" case. Returns `''` when the repo doesn't exist yet.
 */
export async function diffBetweenRefs(
  dir: string,
  fromRef: string,
  toRef: string,
  absFilepath: string
): Promise<string> {
  if (!existsSync(join(dir, '.git'))) return ''
  const filepath = toRepoRel(dir, absFilepath)
  const oldText = (await readFileAtRef(dir, fromRef, absFilepath)) ?? ''
  const newText = (await readFileAtRef(dir, toRef, absFilepath)) ?? ''
  return createTwoFilesPatch(
    filepath,
    filepath,
    oldText,
    newText,
    `${fromRef.slice(0, 8)}`,
    `${toRef.slice(0, 8)}`
  )
}

// ---------------------------------------------------------------------------
// restore (non-destructive, §4.7)
// ---------------------------------------------------------------------------

export interface RestoreResult {
  /** The flush commit made of the pre-restore state (null if nothing was dirty). */
  flushedOid: string | null
  /** The restored content written to disk, or null if the path didn't exist at ref. */
  content: string | null
}

async function restoreUnlocked(
  dir: string,
  ref: string,
  absFilepath: string,
  flushIdentity: GitIdentity
): Promise<RestoreResult> {
  await ensureRepoUnlocked(dir)
  const rel = toRepoRel(dir, absFilepath)
  // §4.7: commit/flush the CURRENT state first so a restore can never lose
  // uncommitted work — only then overwrite with the old bytes.
  const flushedOid = await commitUnlocked(
    dir,
    [rel],
    `checkpoint: before restore of ${rel}`,
    flushIdentity
  )
  const content = await readFileAtRef(dir, ref, absFilepath)
  if (content === null) return { flushedOid, content: null }
  // Write the old bytes back through the atomic-write + self-write machinery so the
  // watcher recognizes our own bytes; the caller drives the reindex/reload
  // explicitly (raw checkout bytes are not otherwise self-write-marked, and the
  // watcher path is debounced/lossy/macOS-Windows-only).
  markSelfWrite(absFilepath, content)
  atomicWriteFile(absFilepath, content)
  return { flushedOid, content }
}

/**
 * Restore `absFilepath` to its state at `ref`, NON-DESTRUCTIVELY (§4.7): the
 * current state is committed/flushed first, then the old bytes are written back.
 * Returns the flush commit oid and the restored content. Serialized per dir. The
 * CALLER must reindex the affected path and emit documents:content-changed /
 * documents:changed (the watcher is not relied upon).
 */
export function restorePath(
  dir: string,
  ref: string,
  absFilepath: string,
  flushIdentity: GitIdentity = APP_IDENTITY
): Promise<RestoreResult> {
  return enqueue(dir, () => restoreUnlocked(dir, ref, absFilepath, flushIdentity))
}

// ---------------------------------------------------------------------------
// vault-level restore (whole tree → a commit, non-destructive, §4.7)
// ---------------------------------------------------------------------------

export interface VaultRestoreResult {
  /** The flush commit of the pre-restore whole-tree state (null if nothing was dirty). */
  flushedOid: string | null
  /**
   * Absolute paths whose on-disk bytes were changed by the restore (written back
   * to the `ref` state, or deleted because they didn't exist at `ref`). The caller
   * MUST reindex each and emit documents:content-changed / documents:changed — the
   * raw checkout bytes are self-write-marked, so the watcher won't drive the reload.
   */
  restoredPaths: string[]
}

async function restoreVaultUnlocked(
  dir: string,
  ref: string,
  flushIdentity: GitIdentity
): Promise<VaultRestoreResult> {
  await ensureRepoUnlocked(dir)
  if (!existsSync(join(dir, '.git'))) return { flushedOid: null, restoredPaths: [] }

  // §4.7: commit/flush the CURRENT whole-tree state first so a vault restore can
  // never lose uncommitted work across ANY file — only then overwrite. After this
  // the worktree equals HEAD, so diffing TREE(ref) vs TREE(HEAD) yields exactly the
  // files the restore must touch.
  const flushedOid = await commitUnlocked(
    dir,
    undefined,
    `checkpoint: before vault restore to ${ref.slice(0, 8)}`,
    flushIdentity
  )

  // isomorphic-git has no diff() — enumerate the changed paths by walking the two
  // trees in lockstep and comparing blob oids (directories skipped). A path present
  // at `ref` with a different/absent oid in HEAD is rewritten to its `ref` bytes; a
  // path present in HEAD but absent at `ref` is deleted.
  const changed = await git.walk({
    fs,
    dir,
    trees: [git.TREE({ ref }), git.TREE({ ref: 'HEAD' })],
    map: async (filepath, entries) => {
      if (filepath === '.') return undefined
      const [tRef, tHead] = entries
      const refType = tRef ? await tRef.type() : null
      const headType = tHead ? await tHead.type() : null
      if (refType === 'tree' || headType === 'tree') return undefined // descend, don't act
      const refOid = tRef ? await tRef.oid() : null
      const headOid = tHead ? await tHead.oid() : null
      if (refOid === headOid) return undefined // unchanged
      return { filepath, refOid }
    }
  })

  const restoredPaths: string[] = []
  for (const entry of changed as { filepath: string; refOid: string | null }[]) {
    const abs = join(dir, entry.filepath)
    if (entry.refOid === null) {
      // Present in HEAD, absent at `ref` → remove from disk. The flush commit above
      // already captured its pre-restore content, so this is recoverable.
      if (existsSync(abs)) fs.rmSync(abs)
    } else {
      const { blob } = await git.readBlob({ fs, dir, oid: ref, filepath: entry.filepath })
      const content = Buffer.from(blob).toString('utf-8')
      markSelfWrite(abs, content)
      atomicWriteFile(abs, content)
    }
    restoredPaths.push(abs)
  }
  return { flushedOid, restoredPaths }
}

/**
 * Restore the WHOLE vault to its state at `ref`, NON-DESTRUCTIVELY (§4.7): the
 * current whole-tree state is committed/flushed first, then every file that differs
 * from `ref` is rewritten (or deleted) to match. Returns the flush oid and the list
 * of changed absolute paths. Serialized per dir. The CALLER must reindex each
 * restored path and emit the document change events (the watcher is not relied upon).
 */
export function restoreVaultToCommit(
  dir: string,
  ref: string,
  flushIdentity: GitIdentity = APP_IDENTITY
): Promise<VaultRestoreResult> {
  return enqueue(dir, () => restoreVaultUnlocked(dir, ref, flushIdentity))
}

/** Test-only: clear the per-repo serialization queues + gitignore overrides between cases. */
export function __resetRepoQueuesForTest(): void {
  repoQueues.clear()
  gitignoreByRepo.clear()
}
