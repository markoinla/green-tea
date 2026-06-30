import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureRepo, commitPaths, logForPath, logAll, APP_IDENTITY } from './git-service'
import {
  recordDirtyPath,
  startAutoCommit,
  stopAutoCommit,
  setAutoCommitIdleForTest,
  __resetAutoCommitForTest
} from './auto-commit'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gt-autocommit-'))
  __resetAutoCommitForTest()
  setAutoCommitIdleForTest(20) // tiny idle window so the debounce fires fast
  startAutoCommit()
})

afterEach(() => {
  stopAutoCommit()
  __resetAutoCommitForTest()
  rmSync(dir, { recursive: true, force: true })
})

function write(rel: string, contents: string): string {
  const abs = join(dir, rel)
  writeFileSync(abs, contents, 'utf-8')
  return abs
}

/** Poll until `fn()` is truthy or the budget runs out. */
async function waitFor<T>(fn: () => Promise<T>, timeoutMs = 1000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - start > timeoutMs) return v
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('auto-commit (debounced safety net)', () => {
  it('commits exactly the dirty paths after the idle window', async () => {
    await ensureRepo(dir)
    const abs = write('note.md', '# hi\n')
    recordDirtyPath(dir, abs)

    const log = await waitFor(async () => {
      const l = await logForPath(dir, abs)
      return l.length > 0 ? l : null
    })
    expect(log!.length).toBe(1)
    expect(log![0].message).toMatch(/^autosave: 1 file$/)
    expect(log![0].authorEmail).toBe(APP_IDENTITY.email)
  })

  it('coalesces multiple dirty paths into one batched commit', async () => {
    await ensureRepo(dir)
    const a = write('a.md', 'a\n')
    const b = write('b.md', 'b\n')
    recordDirtyPath(dir, a)
    recordDirtyPath(dir, b)

    const log = await waitFor(async () => {
      const l = await logAll(dir)
      return l.length > 0 ? l : null
    })
    expect(log!.length).toBe(1)
    expect(log![0].message).toBe('autosave: 2 files')
    // Both files are in that single commit.
    expect((await logForPath(dir, a)).length).toBe(1)
    expect((await logForPath(dir, b)).length).toBe(1)
  })

  it('debounce re-arms on each new dirty path (idle, not periodic)', async () => {
    await ensureRepo(dir)
    const abs = write('note.md', 'v1\n')
    recordDirtyPath(dir, abs)
    // Keep poking before the 20ms idle elapses, mutating each time.
    for (let i = 2; i <= 5; i++) {
      await new Promise((r) => setTimeout(r, 8))
      writeFileSync(abs, `v${i}\n`, 'utf-8')
      recordDirtyPath(dir, abs)
    }
    const log = await waitFor(async () => {
      const l = await logForPath(dir, abs)
      return l.length > 0 ? l : null
    })
    // The rapid pokes collapsed into a single commit of the final content.
    expect(log!.length).toBe(1)
  })

  it('does nothing when stopped (no commit after teardown), but flushes pending', async () => {
    await ensureRepo(dir)
    const abs = write('note.md', 'x\n')
    recordDirtyPath(dir, abs)
    // stopAutoCommit flushes pending best-effort, so the queued path still lands.
    stopAutoCommit()
    const flushed = await waitFor(async () => {
      const l = await logForPath(dir, abs)
      return l.length > 0 ? l : null
    })
    expect(flushed!.length).toBe(1)

    // After stop, a new dirty path is ignored (no timer armed).
    const abs2 = write('after.md', 'y\n')
    recordDirtyPath(dir, abs2)
    await new Promise((r) => setTimeout(r, 60))
    expect((await logForPath(dir, abs2)).length).toBe(0)
  })

  it('never mints an empty commit when the path is unchanged vs HEAD', async () => {
    await ensureRepo(dir)
    const abs = write('note.md', 'same\n')
    await commitPaths(dir, [abs], 'seed', APP_IDENTITY)
    // Mark dirty without actually changing the bytes.
    recordDirtyPath(dir, abs)
    await new Promise((r) => setTimeout(r, 60))
    // Still just the seed commit — the autosave found nothing to commit.
    expect((await logForPath(dir, abs)).length).toBe(1)
  })
})
