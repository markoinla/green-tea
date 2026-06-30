import { describe, it, expect } from 'vitest'
import { classifyDiffLine, parseDiffLines, hasChanges } from './note-history-diff'

describe('classifyDiffLine', () => {
  it('classifies file headers before add/del', () => {
    expect(classifyDiffLine('--- note.md\told')).toBe('header')
    expect(classifyDiffLine('+++ note.md\tnew')).toBe('header')
  })

  it('classifies hunk, meta, add, del, context', () => {
    expect(classifyDiffLine('@@ -1,3 +1,4 @@')).toBe('hunk')
    expect(classifyDiffLine('Index: note.md')).toBe('meta')
    expect(
      classifyDiffLine('===================================================================')
    ).toBe('meta')
    expect(classifyDiffLine('\\ No newline at end of file')).toBe('meta')
    expect(classifyDiffLine('+added line')).toBe('add')
    expect(classifyDiffLine('-removed line')).toBe('del')
    expect(classifyDiffLine(' unchanged line')).toBe('context')
    expect(classifyDiffLine('')).toBe('context')
  })
})

describe('parseDiffLines', () => {
  it('returns [] for an empty patch', () => {
    expect(parseDiffLines('')).toEqual([])
  })

  it('drops a single trailing newline without losing interior blank lines', () => {
    const lines = parseDiffLines('@@ -1 +1 @@\n-a\n+b\n')
    expect(lines).toEqual([
      { type: 'hunk', text: '@@ -1 +1 @@' },
      { type: 'del', text: '-a' },
      { type: 'add', text: '+b' }
    ])
  })

  it('keeps an interior blank context line', () => {
    const lines = parseDiffLines(' a\n\n b')
    expect(lines.map((l) => l.type)).toEqual(['context', 'context', 'context'])
  })
})

describe('hasChanges', () => {
  it('is false for a header-only patch', () => {
    expect(hasChanges('--- note.md\n+++ note.md\n')).toBe(false)
  })

  it('is true when there is an add or del row', () => {
    expect(hasChanges('@@ -1 +1 @@\n-old\n+new\n')).toBe(true)
  })
})
