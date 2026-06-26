import { describe, it, expect } from 'vitest'
import { kindForExt, isNoteKind, kindForRow } from './artifact-kinds'
import {
  titleFromFilename,
  maxBytesForKind,
  MAX_NOTE_BYTES,
  MAX_ARTIFACT_BYTES,
  MAX_BINARY_ARTIFACT_BYTES
} from './note-store'

describe('kindForExt', () => {
  it('maps known extensions and ignores the rest', () => {
    expect(kindForExt('/a/b/note.md')).toBe('note')
    expect(kindForExt('Report.HTML')).toBe('html')
    expect(kindForExt('x.htm')).toBe('html')
    expect(kindForExt('data.csv')).toBe('csv')
    expect(kindForExt('noext')).toBeNull()
  })

  it('maps every image extension to the unified image kind', () => {
    expect(kindForExt('a.png')).toBe('image')
    expect(kindForExt('a.jpg')).toBe('image')
    expect(kindForExt('a.jpeg')).toBe('image')
    expect(kindForExt('a.gif')).toBe('image')
    expect(kindForExt('a.webp')).toBe('image')
    expect(kindForExt('a.svg')).toBe('image')
    expect(kindForExt('PHOTO.PNG')).toBe('image')
  })

  it('maps pdf to the pdf kind', () => {
    expect(kindForExt('doc.pdf')).toBe('pdf')
    expect(kindForExt('Doc.PDF')).toBe('pdf')
  })

  it('leaves unmapped binary extensions unindexed', () => {
    expect(kindForExt('a.heic')).toBeNull()
    expect(kindForExt('a.tiff')).toBeNull()
    expect(kindForExt('a.avif')).toBeNull()
    expect(kindForExt('a.bmp')).toBeNull()
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

describe('maxBytesForKind', () => {
  it('gives image/pdf the large binary ceiling', () => {
    expect(maxBytesForKind('image')).toBe(MAX_BINARY_ARTIFACT_BYTES)
    expect(maxBytesForKind('pdf')).toBe(MAX_BINARY_ARTIFACT_BYTES)
  })

  it('gives notes the note budget and other artifacts the text-artifact budget', () => {
    expect(maxBytesForKind('note')).toBe(MAX_NOTE_BYTES)
    expect(maxBytesForKind('html')).toBe(MAX_ARTIFACT_BYTES)
    expect(maxBytesForKind('csv')).toBe(MAX_ARTIFACT_BYTES)
  })
})

describe('titleFromFilename strips the real extension', () => {
  it('handles notes and artifacts alike', () => {
    expect(titleFromFilename('/v/Report.html')).toBe('Report')
    expect(titleFromFilename('/v/My Note.md')).toBe('My Note')
    expect(titleFromFilename('/v/My Note v1.2.md')).toBe('My Note v1.2')
  })
})
