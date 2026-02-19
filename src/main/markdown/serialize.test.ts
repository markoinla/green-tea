import { describe, it, expect } from 'vitest'
import { serializeBlocks } from './serialize'
import type { SerializableBlock } from './types'
import { randomUUID } from 'crypto'

function block(
  overrides: Partial<SerializableBlock> & { type: SerializableBlock['type'] }
): SerializableBlock {
  return {
    id: randomUUID(),
    content: '',
    children: [],
    ...overrides
  }
}

describe('serializeBlocks', () => {
  it('serializes a paragraph', () => {
    const result = serializeBlocks([block({ type: 'paragraph', content: 'Hello world' })])
    expect(result).toBe('Hello world')
  })

  it('serializes headings 1-5', () => {
    const blocks = [
      block({ type: 'heading1', content: 'H1' }),
      block({ type: 'heading2', content: 'H2' }),
      block({ type: 'heading3', content: 'H3' }),
      block({ type: 'heading4', content: 'H4' }),
      block({ type: 'heading5', content: 'H5' })
    ]
    const result = serializeBlocks(blocks)
    expect(result).toContain('# H1')
    expect(result).toContain('## H2')
    expect(result).toContain('### H3')
    expect(result).toContain('#### H4')
    expect(result).toContain('##### H5')
  })

  it('serializes a code block', () => {
    const result = serializeBlocks([
      block({ type: 'code_block', content: 'const x = 1;\nconst y = 2;' })
    ])
    expect(result).toContain('```')
    expect(result).toContain('const x = 1;')
    expect(result).toContain('const y = 2;')
  })

  it('serializes task items', () => {
    const result = serializeBlocks([
      block({ type: 'task_item', content: 'Done', checked: true, isList: true }),
      block({ type: 'task_item', content: 'Not done', checked: false, isList: true })
    ])
    expect(result).toContain('[x] Done')
    expect(result).toContain('[ ] Not done')
  })

  it('serializes blockquotes', () => {
    const result = serializeBlocks([block({ type: 'blockquote', content: 'A quote' })])
    expect(result).toContain('> A quote')
  })

  it('serializes images', () => {
    const result = serializeBlocks([
      block({ type: 'image', content: '', alt: 'Photo', src: 'https://example.com/img.png' })
    ])
    expect(result).toBe('![Photo](https://example.com/img.png)')
  })

  it('serializes tables with padding', () => {
    const result = serializeBlocks([
      block({
        type: 'table',
        content: '',
        rows: [
          ['Name', 'Age'],
          ['Alice', '30']
        ]
      })
    ])
    expect(result).toContain('| Name')
    expect(result).toContain('| Age')
    expect(result).toContain('---')
    expect(result).toContain('| Alice')
  })

  it('serializes nested children with indentation', () => {
    const result = serializeBlocks([
      block({
        type: 'paragraph',
        content: 'Parent',
        children: [
          block({ type: 'paragraph', content: 'Child 1' }),
          block({
            type: 'paragraph',
            content: 'Child 2',
            children: [block({ type: 'paragraph', content: 'Grandchild' })]
          })
        ]
      })
    ])
    expect(result).toContain('- Parent')
    expect(result).toContain('  - Child 1')
    expect(result).toContain('  - Child 2')
    expect(result).toContain('    - Grandchild')
  })

  it('uses list prefix when isList is true', () => {
    const result = serializeBlocks([
      block({ type: 'paragraph', content: 'Listed item', isList: true })
    ])
    expect(result).toBe('- Listed item')
  })
})
