import { describe, it, expect, beforeEach } from 'vitest'
import { markSelfWrite, consumeSelfWrite, clearSelfWriteRegistry } from './self-write'

beforeEach(() => {
  clearSelfWriteRegistry()
})

describe('self-write registry', () => {
  it('consumes a matching self-write once, then reports false', () => {
    const path = '/vault/Note.md'
    markSelfWrite(path, 'hello world')
    expect(consumeSelfWrite(path, 'hello world')).toBe(true)
    // Consumed — a second event for the same write is not suppressed again.
    expect(consumeSelfWrite(path, 'hello world')).toBe(false)
  })

  it('does not suppress when the content differs (a real external edit)', () => {
    const path = '/vault/Note.md'
    markSelfWrite(path, 'our bytes')
    expect(consumeSelfWrite(path, 'someone else edited this')).toBe(false)
  })

  it('matches across NFD/NFC path normalization', () => {
    // "cafe.md" with e-acute. NFC = precomposed U+00E9; NFD = "e" + combining
    // acute U+0301 (the form macOS fs.watch delivers). Built from code points so
    // the two strings are guaranteed distinct regardless of file encoding.
    const nfc = '/vault/caf' + String.fromCodePoint(0x00e9) + '.md'
    const nfd = '/vault/cafe' + String.fromCodePoint(0x0301) + '.md'
    expect(nfc).not.toBe(nfd) // sanity: the raw strings really do differ
    markSelfWrite(nfc, 'body')
    expect(consumeSelfWrite(nfd, 'body')).toBe(true)
  })

  it('is timing-independent: a hash match still suppresses regardless of age', () => {
    const path = '/vault/Note.md'
    markSelfWrite(path, 'durable')
    // The guard is content-hash keyed, not timer keyed — a matching hash wins
    // regardless of how long the filesystem event took to arrive.
    expect(consumeSelfWrite(path, 'durable')).toBe(true)
  })
})
