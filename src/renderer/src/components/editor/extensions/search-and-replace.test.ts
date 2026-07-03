import { describe, it, expect } from 'vitest'
import { Schema, Node as PMNode } from '@tiptap/pm/model'
import { findMatches } from './search-and-replace'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {}
  }
})

const doc = (...paragraphs: string[]): PMNode =>
  schema.nodes.doc.create(
    null,
    paragraphs.map((t) => schema.nodes.paragraph.create(null, t ? [schema.text(t)] : []))
  )

describe('findMatches', () => {
  it('returns empty for an empty search term', () => {
    expect(findMatches(doc('hello world'), '', false)).toEqual([])
  })

  it('finds all occurrences within a single text node', () => {
    const d = doc('abc abc abc')
    const results = findMatches(d, 'abc', false)
    expect(results).toEqual([
      { from: 1, to: 4 },
      { from: 5, to: 8 },
      { from: 9, to: 12 }
    ])
    for (const r of results) {
      expect(d.textBetween(r.from, r.to)).toBe('abc')
    }
  })

  it('finds matches across multiple paragraphs with correct positions', () => {
    const d = doc('first tea', 'green tea time')
    const results = findMatches(d, 'tea', false)
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(d.textBetween(r.from, r.to)).toBe('tea')
    }
  })

  it('respects case sensitivity', () => {
    const d = doc('Tea tea TEA')
    expect(findMatches(d, 'tea', true)).toHaveLength(1)
    expect(findMatches(d, 'tea', false)).toHaveLength(3)
    // Result length always matches the search term, even case-insensitively
    const [r] = findMatches(d, 'TEA', false)
    expect(r.to - r.from).toBe(3)
  })

  it('finds overlapping matches', () => {
    const d = doc('aaa')
    expect(findMatches(d, 'aa', false)).toEqual([
      { from: 1, to: 3 },
      { from: 2, to: 4 }
    ])
  })
})
