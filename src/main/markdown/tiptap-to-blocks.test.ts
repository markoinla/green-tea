import { describe, it, expect } from 'vitest'
import { tiptapJsonToBlocks } from './tiptap-to-blocks'

describe('tiptapJsonToBlocks', () => {
  it('converts a paragraph', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }]
    })
    const blocks = tiptapJsonToBlocks(json)
    expect(blocks.length).toBe(1)
    expect(blocks[0].type).toBe('paragraph')
    expect(blocks[0].content).toBe('Hello')
  })

  it('converts headings with levels', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H1' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'H3' }] }
      ]
    })
    const blocks = tiptapJsonToBlocks(json)
    expect(blocks[0].type).toBe('heading1')
    expect(blocks[0].content).toBe('H1')
    expect(blocks[1].type).toBe('heading3')
  })

  it('converts code blocks', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;' }] }]
    })
    const blocks = tiptapJsonToBlocks(json)
    expect(blocks[0].type).toBe('code_block')
    expect(blocks[0].content).toBe('const x = 1;')
  })

  it('converts blockquotes', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] }]
        }
      ]
    })
    const blocks = tiptapJsonToBlocks(json)
    expect(blocks[0].type).toBe('blockquote')
    expect(blocks[0].content).toBe('Quote')
  })

  it('converts tables', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col A' }] }]
                },
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col B' }] }]
                }
              ]
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }]
                },
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }]
                }
              ]
            }
          ]
        }
      ]
    })
    const blocks = tiptapJsonToBlocks(json)
    expect(blocks[0].type).toBe('table')
    expect(blocks[0].rows).toEqual([
      ['Col A', 'Col B'],
      ['1', '2']
    ])
  })

  it('converts images', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://img.png', alt: 'Photo' } }]
    })
    const blocks = tiptapJsonToBlocks(json)
    expect(blocks[0].type).toBe('image')
    expect(blocks[0].src).toBe('https://img.png')
    expect(blocks[0].alt).toBe('Photo')
  })

  it('converts outliner items with nested lists', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'outlinerList',
          content: [
            {
              type: 'outlinerItem',
              attrs: { blockType: 'paragraph', checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
                {
                  type: 'outlinerList',
                  content: [
                    {
                      type: 'outlinerItem',
                      attrs: { blockType: 'paragraph', checked: false },
                      content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'Child' }] }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
    const blocks = tiptapJsonToBlocks(json)
    expect(blocks.length).toBe(1)
    expect(blocks[0].content).toBe('Parent')
    expect(blocks[0].isList).toBe(true)
    expect(blocks[0].children.length).toBe(1)
    expect(blocks[0].children[0].content).toBe('Child')
  })

  it('converts inline marks (bold, italic, code, link)', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'code', marks: [{ type: 'code' }] },
            { type: 'text', text: ' ' },
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }]
            }
          ]
        }
      ]
    })
    const blocks = tiptapJsonToBlocks(json)
    expect(blocks[0].content).toBe(
      '**bold** *italic* `code` [link](https://example.com)'
    )
  })

  it('returns empty array for invalid JSON', () => {
    expect(tiptapJsonToBlocks('not json')).toEqual([])
  })

  it('returns empty array for non-doc type', () => {
    expect(tiptapJsonToBlocks(JSON.stringify({ type: 'other' }))).toEqual([])
  })

  it('returns empty array for doc without content', () => {
    expect(tiptapJsonToBlocks(JSON.stringify({ type: 'doc' }))).toEqual([])
  })

  it('handles task items in outliner', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'outlinerList',
          content: [
            {
              type: 'outlinerItem',
              attrs: { blockType: 'task_item', checked: true },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Done task' }] }
              ]
            }
          ]
        }
      ]
    })
    const blocks = tiptapJsonToBlocks(json)
    expect(blocks[0].type).toBe('task_item')
    expect(blocks[0].checked).toBe(true)
    expect(blocks[0].content).toBe('Done task')
  })
})
