import { describe, it, expect } from 'vitest'
import { createMarkdownDiff, applyMarkdownDiff, parseDiffHunks } from './diff'

describe('createMarkdownDiff', () => {
  it('produces valid unified diff', () => {
    const diff = createMarkdownDiff('Hello\nWorld\n', 'Hello\nEarth\n')
    expect(diff).toContain('---')
    expect(diff).toContain('+++')
    expect(diff).toContain('@@')
    expect(diff).toContain('-World')
    expect(diff).toContain('+Earth')
  })

  it('produces empty-looking diff for identical content', () => {
    const diff = createMarkdownDiff('Same\n', 'Same\n')
    // No hunk headers when content is identical
    expect(diff).not.toContain('@@')
  })
})

describe('applyMarkdownDiff', () => {
  it('recovers target markdown', () => {
    const old = 'Line 1\nLine 2\nLine 3\n'
    const target = 'Line 1\nModified\nLine 3\n'
    const diff = createMarkdownDiff(old, target)
    const result = applyMarkdownDiff(old, diff)
    expect(result).toBe(target)
  })

  it('throws when patch does not match source', () => {
    const diff = createMarkdownDiff('A\n', 'B\n')
    expect(() => applyMarkdownDiff('Completely different\n', diff)).toThrow(
      'Failed to apply patch'
    )
  })
})

describe('parseDiffHunks', () => {
  it('parses add/remove/context lines', () => {
    const diff = createMarkdownDiff('Line 1\nOld\nLine 3\n', 'Line 1\nNew\nLine 3\n')
    const hunks = parseDiffHunks(diff)

    expect(hunks.length).toBeGreaterThanOrEqual(1)
    const hunk = hunks[0]

    const addLines = hunk.lines.filter((l) => l.type === 'add')
    const removeLines = hunk.lines.filter((l) => l.type === 'remove')
    const contextLines = hunk.lines.filter((l) => l.type === 'context')

    expect(addLines.length).toBeGreaterThanOrEqual(1)
    expect(removeLines.length).toBeGreaterThanOrEqual(1)
    expect(contextLines.length).toBeGreaterThanOrEqual(1)

    expect(addLines.some((l) => l.content === 'New')).toBe(true)
    expect(removeLines.some((l) => l.content === 'Old')).toBe(true)
  })

  it('parses hunk header with start and line counts', () => {
    const diff = createMarkdownDiff('A\nB\nC\n', 'A\nX\nC\n')
    const hunks = parseDiffHunks(diff)
    expect(hunks.length).toBe(1)
    expect(hunks[0].oldStart).toBeGreaterThanOrEqual(1)
    expect(hunks[0].newStart).toBeGreaterThanOrEqual(1)
  })

  it('returns empty array for no-change diff', () => {
    const diff = createMarkdownDiff('Same\n', 'Same\n')
    const hunks = parseDiffHunks(diff)
    expect(hunks.length).toBe(0)
  })
})

describe('diff round-trip', () => {
  it('apply(old, diff(old, new)) === new', () => {
    const old = '# Title\n\nParagraph 1\n\nParagraph 2\n'
    const target = '# New Title\n\nParagraph 1\n\nNew paragraph\n\nParagraph 3\n'
    const diff = createMarkdownDiff(old, target)
    const result = applyMarkdownDiff(old, diff)
    expect(result).toBe(target)
  })

  it('handles multi-line additions and deletions', () => {
    const old = 'A\nB\nC\nD\nE\n'
    const target = 'A\nX\nY\nD\nE\nF\n'
    const diff = createMarkdownDiff(old, target)
    const result = applyMarkdownDiff(old, diff)
    expect(result).toBe(target)
  })
})
