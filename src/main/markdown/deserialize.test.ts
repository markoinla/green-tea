import { describe, it, expect } from 'vitest'
import { deserializeMarkdown } from './deserialize'

describe('deserializeMarkdown', () => {
  it('parses a paragraph', () => {
    const blocks = deserializeMarkdown('Hello world')
    expect(blocks.length).toBe(1)
    expect(blocks[0].type).toBe('paragraph')
    expect(blocks[0].content).toBe('Hello world')
  })

  it('parses headings 1-5', () => {
    const md = '# H1\n## H2\n### H3\n#### H4\n##### H5'
    const blocks = deserializeMarkdown(md)
    expect(blocks.length).toBe(5)
    expect(blocks[0].type).toBe('heading1')
    expect(blocks[0].content).toBe('H1')
    expect(blocks[1].type).toBe('heading2')
    expect(blocks[2].type).toBe('heading3')
    expect(blocks[3].type).toBe('heading4')
    expect(blocks[4].type).toBe('heading5')
  })

  it('parses task items', () => {
    const md = '- [x] Done\n- [ ] Not done'
    const blocks = deserializeMarkdown(md)
    expect(blocks.length).toBe(2)
    expect(blocks[0].type).toBe('task_item')
    expect(blocks[0].checked).toBe(true)
    expect(blocks[0].content).toBe('Done')
    expect(blocks[1].type).toBe('task_item')
    expect(blocks[1].checked).toBe(false)
  })

  it('parses blockquotes', () => {
    const blocks = deserializeMarkdown('> A quote')
    expect(blocks[0].type).toBe('blockquote')
    expect(blocks[0].content).toBe('A quote')
  })

  it('parses images', () => {
    const blocks = deserializeMarkdown('![Alt text](https://example.com/img.png)')
    expect(blocks[0].type).toBe('image')
    expect(blocks[0].alt).toBe('Alt text')
    expect(blocks[0].src).toBe('https://example.com/img.png')
  })

  it('parses code blocks with closing fence', () => {
    const md = '```\nconst x = 1;\nconst y = 2;\n```'
    const blocks = deserializeMarkdown(md)
    expect(blocks.length).toBe(1)
    expect(blocks[0].type).toBe('code_block')
    expect(blocks[0].content).toBe('const x = 1;\nconst y = 2;')
  })

  it('parses code blocks without closing fence', () => {
    const md = '```\nconst x = 1;'
    const blocks = deserializeMarkdown(md)
    expect(blocks[0].type).toBe('code_block')
    expect(blocks[0].content).toBe('const x = 1;')
  })

  it('parses tables and skips separator row', () => {
    const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |'
    const blocks = deserializeMarkdown(md)
    expect(blocks.length).toBe(1)
    expect(blocks[0].type).toBe('table')
    expect(blocks[0].rows!.length).toBe(2) // header + data, no separator
    expect(blocks[0].rows![0]).toEqual(['Name', 'Age'])
    expect(blocks[0].rows![1]).toEqual(['Alice', '30'])
  })

  it('parses indent-based hierarchy (2 spaces = 1 level)', () => {
    const md = '- Parent\n  - Child 1\n  - Child 2\n    - Grandchild'
    const blocks = deserializeMarkdown(md)
    expect(blocks.length).toBe(1)
    expect(blocks[0].content).toBe('Parent')
    expect(blocks[0].children.length).toBe(2)
    expect(blocks[0].children[0].content).toBe('Child 1')
    expect(blocks[0].children[1].content).toBe('Child 2')
    expect(blocks[0].children[1].children.length).toBe(1)
    expect(blocks[0].children[1].children[0].content).toBe('Grandchild')
  })

  it('skips blank lines', () => {
    const md = 'Line 1\n\nLine 2'
    const blocks = deserializeMarkdown(md)
    expect(blocks.length).toBe(2)
    expect(blocks[0].content).toBe('Line 1')
    expect(blocks[1].content).toBe('Line 2')
  })

  it('parses list items as paragraphs with isList', () => {
    const md = '- Item 1\n- Item 2'
    const blocks = deserializeMarkdown(md)
    expect(blocks.length).toBe(2)
    expect(blocks[0].isList).toBe(true)
    expect(blocks[0].content).toBe('Item 1')
  })
})
