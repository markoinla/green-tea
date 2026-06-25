import { describe, it, expect } from 'vitest'
import { kindForExt, isNoteKind, kindForRow } from './artifact-kinds'
import { titleFromFilename } from './note-store'

describe('kindForExt', () => {
  it('maps known extensions and ignores the rest', () => {
    expect(kindForExt('/a/b/note.md')).toBe('note')
    expect(kindForExt('Report.HTML')).toBe('html')
    expect(kindForExt('x.htm')).toBe('html')
    expect(kindForExt('data.csv')).toBeNull() // not registered yet
    expect(kindForExt('noext')).toBeNull()
  })

  it('kindForRow defaults a null/unmapped path to note (never silently artifact)', () => {
    expect(kindForRow(null)).toBe('note')
    expect(kindForRow('weird.bin')).toBe('note')
    expect(kindForRow('a.html')).toBe('html')
  })

  it('isNoteKind is the binary pipeline discriminator', () => {
    expect(isNoteKind('note')).toBe(true)
    expect(isNoteKind('html')).toBe(false)
  })
})

describe('titleFromFilename strips the real extension', () => {
  it('handles notes and artifacts alike', () => {
    expect(titleFromFilename('/v/Report.html')).toBe('Report')
    expect(titleFromFilename('/v/My Note.md')).toBe('My Note')
    expect(titleFromFilename('/v/My Note v1.2.md')).toBe('My Note v1.2')
  })
})
