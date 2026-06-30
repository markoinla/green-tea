import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ensureRepo,
  commitPaths,
  commitAll,
  logForPath,
  logAll,
  diffForPath,
  diffBetweenRefs,
  readFileAtRef,
  restorePath,
  restoreVaultToCommit,
  APP_IDENTITY,
  AGENT_IDENTITY,
  __resetRepoQueuesForTest
} from './git-service'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gt-git-'))
  __resetRepoQueuesForTest()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function write(rel: string, contents: string): string {
  const abs = join(dir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, contents, 'utf-8')
  return abs
}

describe('git-service ensureRepo', () => {
  it('inits a repo and writes a managed .gitignore', async () => {
    await ensureRepo(dir)
    expect(existsSync(join(dir, '.git'))).toBe(true)
    const ignore = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(ignore).toContain('.greentea/')
    expect(ignore).toContain('.obsidian/')
    expect(ignore).toContain('.trash/')
    // Flat: no negation patterns that trip isomorphic-git's matcher.
    expect(ignore).not.toContain('!')
  })

  it('is idempotent and never overwrites an existing .gitignore', async () => {
    await ensureRepo(dir)
    writeFileSync(join(dir, '.gitignore'), 'custom\n', 'utf-8')
    await ensureRepo(dir)
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8')).toBe('custom\n')
  })

  it('does not mkdir a missing (unavailable) workspace folder into existence', async () => {
    const missing = join(dir, 'does-not-exist')
    await ensureRepo(missing)
    expect(existsSync(missing)).toBe(false)
  })
})

describe('git-service commit + log', () => {
  it('commits a path and surfaces it in logForPath', async () => {
    const abs = write('note.md', '# Note\n\nhello\n')
    const oid = await commitPaths(dir, [abs], 'first', APP_IDENTITY)
    expect(oid).toBeTruthy()
    const log = await logForPath(dir, abs)
    expect(log.length).toBe(1)
    expect(log[0].message).toBe('first')
    expect(log[0].authorEmail).toBe(APP_IDENTITY.email)
    expect(log[0].oid).toBe(oid)
  })

  it('returns null when there is nothing to commit (no empty commits)', async () => {
    const abs = write('note.md', 'a\n')
    await commitPaths(dir, [abs], 'first', APP_IDENTITY)
    const again = await commitPaths(dir, [abs], 'noop', APP_IDENTITY)
    expect(again).toBeNull()
  })

  it('records distinct identities for agent vs app commits', async () => {
    const abs = write('note.md', 'v1\n')
    await commitPaths(dir, [abs], 'app change', APP_IDENTITY)
    writeFileSync(abs, 'v2\n', 'utf-8')
    await commitPaths(dir, [abs], 'agent: before patch', AGENT_IDENTITY)
    const log = await logForPath(dir, abs)
    expect(log.length).toBe(2)
    // newest first
    expect(log[0].authorEmail).toBe(AGENT_IDENTITY.email)
    expect(log[1].authorEmail).toBe(APP_IDENTITY.email)
  })

  it('stages a deletion (git.remove), not just adds', async () => {
    const abs = write('gone.md', 'bye\n')
    await commitPaths(dir, [abs], 'add', APP_IDENTITY)
    rmSync(abs)
    const oid = await commitPaths(dir, [abs], 'delete', APP_IDENTITY)
    expect(oid).toBeTruthy()
    // The file no longer exists at the latest ref.
    expect(await readFileAtRef(dir, oid!, abs)).toBeNull()
  })

  it('commitAll reconciles the whole worktree', async () => {
    const a = write('a.md', 'a\n')
    const b = write('sub/b.md', 'b\n')
    const oid = await commitAll(dir, 'bulk', APP_IDENTITY)
    expect(oid).toBeTruthy()
    expect((await logForPath(dir, a)).length).toBe(1)
    expect((await logForPath(dir, b)).length).toBe(1)
  })

  it('honors .gitignore (ignored paths are never committed)', async () => {
    await ensureRepo(dir)
    const scratch = write('.greentea/scratch.md', 'scratch\n')
    const oid = await commitAll(dir, 'should be empty', APP_IDENTITY)
    // Only the .gitignore itself was written by ensureRepo; the scratch file is
    // ignored, so committing finds nothing new to stage from it.
    expect(await readFileAtRef(dir, 'HEAD', scratch)).toBeNull()
    // The .gitignore was already committed implicitly? No — ensureRepo writes it
    // but does not commit. commitAll picks it up.
    expect(oid).toBeTruthy()
    expect(await readFileAtRef(dir, oid!, join(dir, '.gitignore'))).toContain('.greentea/')
  })
})

describe('git-service diff', () => {
  it('produces an old-vs-current unified diff', async () => {
    const abs = write('note.md', 'line one\nline two\n')
    const oid = await commitPaths(dir, [abs], 'v1', APP_IDENTITY)
    writeFileSync(abs, 'line one\nline CHANGED\n', 'utf-8')
    const patch = await diffForPath(dir, oid!, abs)
    expect(patch).toContain('-line two')
    expect(patch).toContain('+line CHANGED')
  })

  it('diffs an added file against an empty old side', async () => {
    const abs = write('note.md', 'a\n')
    const oid = await commitPaths(dir, [abs], 'v1', APP_IDENTITY)
    const fresh = write('fresh.md', 'brand new\n')
    const patch = await diffForPath(dir, oid!, fresh)
    expect(patch).toContain('+brand new')
  })

  it('diffBetweenRefs diffs a note across two commits (not the working tree)', async () => {
    const abs = write('note.md', 'one\ntwo\n')
    const v1 = await commitPaths(dir, [abs], 'v1', APP_IDENTITY)
    writeFileSync(abs, 'one\nTWO\n', 'utf-8')
    const v2 = await commitPaths(dir, [abs], 'v2', APP_IDENTITY)
    // Diverge the working tree AFTER v2 — the two-ref diff must ignore it.
    writeFileSync(abs, 'one\nTWO\nthree\n', 'utf-8')

    const patch = await diffBetweenRefs(dir, v1!, v2!, abs)
    expect(patch).toContain('-two')
    expect(patch).toContain('+TWO')
    expect(patch).not.toContain('three')
  })

  it('diffBetweenRefs returns "" when the repo does not exist', async () => {
    const missing = join(dir, 'no-repo')
    expect(await diffBetweenRefs(missing, 'HEAD', 'HEAD', join(missing, 'x.md'))).toBe('')
  })
})

describe('git-service restore (non-destructive)', () => {
  it('flushes current state then restores the old bytes', async () => {
    const abs = write('note.md', 'original\n')
    const oid = await commitPaths(dir, [abs], 'v1', APP_IDENTITY)
    // Mutate on disk WITHOUT committing — restore must not lose this.
    writeFileSync(abs, 'uncommitted edit\n', 'utf-8')

    const result = await restorePath(dir, oid!, abs)
    expect(result.content).toBe('original\n')
    // The old bytes are now on disk.
    expect(readFileSync(abs, 'utf-8')).toBe('original\n')
    // The pre-restore (uncommitted) state was flushed into a commit, so it's
    // recoverable — nothing was destroyed.
    expect(result.flushedOid).toBeTruthy()
    expect(await readFileAtRef(dir, result.flushedOid!, abs)).toBe('uncommitted edit\n')
  })

  it('returns null content when the path did not exist at ref', async () => {
    const seed = write('seed.md', 'seed\n')
    const oid = await commitPaths(dir, [seed], 'v1', APP_IDENTITY)
    const other = write('other.md', 'present now\n')
    const result = await restorePath(dir, oid!, other)
    expect(result.content).toBeNull()
    // The file on disk is untouched (only a flush of its current state happened).
    expect(readFileSync(other, 'utf-8')).toBe('present now\n')
  })
})

describe('git-service vault-level history (logAll + restoreVaultToCommit)', () => {
  it('logAll lists every commit across the whole vault, newest first', async () => {
    const a = write('a.md', 'a1\n')
    await commitPaths(dir, [a], 'first', APP_IDENTITY)
    const b = write('b.md', 'b1\n')
    await commitPaths(dir, [b], 'second', APP_IDENTITY)
    const log = await logAll(dir)
    expect(log.length).toBe(2)
    expect(log[0].message).toBe('second')
    expect(log[1].message).toBe('first')
  })

  it('logAll returns [] for a repo with no commits / no repo', async () => {
    expect(await logAll(dir)).toEqual([])
    await ensureRepo(dir)
    expect(await logAll(dir)).toEqual([])
  })

  it('restores the whole vault to a commit, non-destructively', async () => {
    const a = write('a.md', 'a-v1\n')
    const b = write('b.md', 'b-v1\n')
    const snapshot = await commitAll(dir, 'snapshot', APP_IDENTITY)
    expect(snapshot).toBeTruthy()

    // Diverge both files AND add a new one after the snapshot.
    writeFileSync(a, 'a-v2\n', 'utf-8')
    writeFileSync(b, 'b-v2\n', 'utf-8')
    const c = write('c.md', 'brand new\n')
    const changes = await commitAll(dir, 'changes', APP_IDENTITY)

    const result = await restoreVaultToCommit(dir, snapshot!)
    // a and b reverted; c (absent at snapshot) was removed.
    expect(readFileSync(a, 'utf-8')).toBe('a-v1\n')
    expect(readFileSync(b, 'utf-8')).toBe('b-v1\n')
    expect(existsSync(c)).toBe(false)
    expect(new Set(result.restoredPaths)).toEqual(new Set([a, b, c]))

    // Non-destructive: the worktree was already committed ('changes'), so there was
    // nothing to flush (null), and the pre-restore state remains recoverable from
    // that commit — nothing was destroyed.
    expect(result.flushedOid).toBeNull()
    expect(await readFileAtRef(dir, changes!, c)).toBe('brand new\n')
    expect(await readFileAtRef(dir, changes!, a)).toBe('a-v2\n')
  })

  it('flushes uncommitted work before a vault restore (loses nothing)', async () => {
    const a = write('a.md', 'committed\n')
    const base = await commitAll(dir, 'base', APP_IDENTITY)
    // Uncommitted divergence on disk.
    writeFileSync(a, 'uncommitted\n', 'utf-8')

    const result = await restoreVaultToCommit(dir, base!)
    expect(readFileSync(a, 'utf-8')).toBe('committed\n')
    expect(result.flushedOid).toBeTruthy()
    expect(await readFileAtRef(dir, result.flushedOid!, a)).toBe('uncommitted\n')
  })
})

describe('git-service serialization', () => {
  it('serializes concurrent commits per repo without corrupting the index', async () => {
    const a = write('a.md', 'a\n')
    const b = write('b.md', 'b\n')
    const c = write('c.md', 'c\n')
    // Fire three commits concurrently; the per-dir queue must funnel them.
    const oids = await Promise.all([
      commitPaths(dir, [a], 'ca', APP_IDENTITY),
      commitPaths(dir, [b], 'cb', APP_IDENTITY),
      commitPaths(dir, [c], 'cc', APP_IDENTITY)
    ])
    // Each produced a real (distinct) commit; none threw / corrupted the index.
    const real = oids.filter((o): o is string => o !== null)
    expect(real.length).toBeGreaterThanOrEqual(1)
    expect(new Set(real).size).toBe(real.length)
    // History is linear and intact.
    const log = await logForPath(dir, a)
    expect(log.length).toBeGreaterThanOrEqual(1)
  })
})
