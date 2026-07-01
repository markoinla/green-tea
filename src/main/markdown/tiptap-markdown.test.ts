import { describe, it, expect } from 'vitest'
import { markdownToTiptap, tiptapToMarkdown, type TTDoc } from './tiptap-markdown'
import { parseNoteFile, serializeNoteFile } from './note-file'

/** Normalize markdown through a full md -> tiptap -> md cycle. */
function norm(md: string): string {
  return tiptapToMarkdown(markdownToTiptap(md))
}

// The corpus exercises every supported feature. Each entry is run through the
// idempotency gate: once normalized, further cycles must not change the text.
const CORPUS: Record<string, string> = {
  paragraph: 'Hello world',
  headings: '# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6',
  bold: 'This is **bold** text',
  italic: 'This is *italic* text',
  strike: 'This is ~~struck~~ text',
  inlineCode: 'Call `fn()` now',
  link: 'See [the docs](https://example.com)',
  linkTitle: 'See [docs](https://example.com "Title")',
  highlight: 'A <mark>highlighted</mark> phrase',
  underline: 'An <u>underlined</u> phrase',
  combinedMarks: 'A <mark>**bold mark**</mark> and <u>*under em*</u>',
  bulletList: '- one\n- two\n- three',
  orderedList: '1. first\n2. second\n3. third',
  nestedList: '- parent\n  - child\n    - grandchild',
  taskList: '- [x] done\n- [ ] todo',
  nestedTask: '- [ ] parent\n  - [x] child',
  wikiLink: 'See [[Other Note]] here',
  wikiLinkAnchor: 'See [[Other Note#Heading]] here',
  wikiLinkSameNoteAnchor: 'Jump to [[#Overview]] below',
  blockquote: '> a quote',
  codeBlock: '```js\nconst x = 1\n```',
  codeNoLang: '```\nplain code\n```',
  table: '| A | B |\n| - | - |\n| 1 | 2 |',
  image: '![alt text](https://example.com/i.png)',
  hr: 'before\n\n***\n\nafter',
  mixed:
    '# Notes\n\nSome **intro** text.\n\n- [x] ship it\n- [ ] write <mark>tests</mark>\n  - nested point\n\n> remember this\n\n```ts\nfoo()\n```\n\n| k | v |\n| - | - |\n| a | b |'
}

describe('markdown <-> tiptap idempotency gate', () => {
  for (const [name, md] of Object.entries(CORPUS)) {
    it(`is a stable fixed point: ${name}`, () => {
      const once = norm(md)
      const twice = norm(once)
      expect(twice).toBe(once)
    })
  }

  it('round-trips the whole corpus concatenated', () => {
    const all = Object.values(CORPUS).join('\n\n')
    const once = norm(all)
    expect(norm(once)).toBe(once)
  })
})

describe('feature fidelity', () => {
  it('preserves heading levels 1-6', () => {
    expect(norm('# A')).toBe('# A\n')
    expect(norm('###### F')).toBe('###### F\n')
  })

  it('encodes highlight as <mark>', () => {
    const doc = markdownToTiptap('<mark>hi</mark>')
    const textNode = doc.content[0].content?.[0]
    expect(textNode?.marks?.some((m) => m.type === 'highlight')).toBe(true)
    expect(tiptapToMarkdown(doc).trim()).toBe('<mark>hi</mark>')
  })

  it('encodes underline as <u>', () => {
    const doc = markdownToTiptap('<u>hi</u>')
    const textNode = doc.content[0].content?.[0]
    expect(textNode?.marks?.some((m) => m.type === 'underline')).toBe(true)
    expect(tiptapToMarkdown(doc).trim()).toBe('<u>hi</u>')
  })

  it('preserves code-block language', () => {
    const doc = markdownToTiptap('```python\nprint(1)\n```')
    expect(doc.content[0].type).toBe('codeBlock')
    expect(doc.content[0].attrs?.language).toBe('python')
    expect(norm('```python\nprint(1)\n```')).toContain('```python')
  })

  it('keeps ordered vs unordered lists distinct', () => {
    const ordered = markdownToTiptap('1. a\n2. b')
    expect(ordered.content[0].type).toBe('outlinerOrderedList')
    const bullet = markdownToTiptap('- a\n- b')
    expect(bullet.content[0].type).toBe('outlinerList')
  })

  it('represents task items with checked state', () => {
    const doc = markdownToTiptap('- [x] done\n- [ ] todo')
    const items = doc.content[0].content ?? []
    expect(items[0].attrs?.blockType).toBe('task_item')
    expect(items[0].attrs?.checked).toBe(true)
    expect(items[1].attrs?.checked).toBe(false)
  })

  it('nests outliner children under the parent item', () => {
    const doc = markdownToTiptap('- parent\n  - child')
    const parent = doc.content[0].content?.[0]
    // outlinerItem -> [paragraph, outlinerList -> [outlinerItem(child)]]
    const childList = parent?.content?.find((n) => n.type === 'outlinerList')
    expect(childList).toBeDefined()
    expect(childList?.content?.[0].attrs?.blockType).toBe('paragraph')
  })

  it('turns a standalone image into a block image node', () => {
    const doc = markdownToTiptap('![cat](cat.png)')
    expect(doc.content[0].type).toBe('image')
    expect(doc.content[0].attrs?.src).toBe('cat.png')
  })

  it('preserves a GFM table structurally', () => {
    const out = norm('| Name | Age |\n| - | - |\n| Sam | 30 |')
    expect(out).toContain('| Name')
    expect(out).toContain('| Sam')
    expect(norm(out)).toBe(out)
  })

  it('parses [[Label]] into a wikiLink node with docId null', () => {
    const doc = markdownToTiptap('[[Other Note]]')
    const node = doc.content[0].content?.[0]
    expect(node?.type).toBe('wikiLink')
    expect(node?.attrs?.label).toBe('Other Note')
    expect(node?.attrs?.docId).toBeNull()
  })

  it('serializes a wikiLink node back to [[Label]] text', () => {
    const doc: TTDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'wikiLink', attrs: { label: 'Other Note', docId: 'abc-123' } }]
        }
      ]
    }
    // The resolved docId is intentionally NOT written to disk.
    expect(tiptapToMarkdown(doc).trim()).toBe('[[Other Note]]')
  })

  it('keeps wikiLinks interleaved with surrounding text', () => {
    const doc = markdownToTiptap('before [[A Note]] after')
    const inline = doc.content[0].content ?? []
    expect(inline.map((n) => n.type)).toEqual(['text', 'wikiLink', 'text'])
    expect(inline[0].text).toBe('before ')
    expect(inline[1].attrs?.label).toBe('A Note')
    expect(inline[2].text).toBe(' after')
    expect(norm('before [[A Note]] after').trim()).toBe('before [[A Note]] after')
  })

  it('parses a plain [[Label]] into a null anchor', () => {
    const node = markdownToTiptap('[[Other Note]]').content[0].content?.[0]
    expect(node?.attrs?.anchor).toBeNull()
  })

  it('parses [[Label#Heading]] into label + anchor attrs', () => {
    const node = markdownToTiptap('[[Other Note#Heading]]').content[0].content?.[0]
    expect(node?.type).toBe('wikiLink')
    expect(node?.attrs?.label).toBe('Other Note')
    expect(node?.attrs?.anchor).toBe('Heading')
  })

  it('parses a same-note [[#Heading]] into an empty label + anchor', () => {
    const node = markdownToTiptap('[[#Overview]]').content[0].content?.[0]
    expect(node?.type).toBe('wikiLink')
    expect(node?.attrs?.label).toBe('')
    expect(node?.attrs?.anchor).toBe('Overview')
  })

  it('serializes an anchored wikiLink back to [[Label#Anchor]]', () => {
    const doc: TTDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'wikiLink',
              attrs: { label: 'Other Note', docId: 'abc-123', anchor: 'Heading' }
            }
          ]
        }
      ]
    }
    expect(tiptapToMarkdown(doc).trim()).toBe('[[Other Note#Heading]]')
  })

  it('serializes a same-note wikiLink (empty label) back to [[#Anchor]]', () => {
    const doc: TTDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'wikiLink', attrs: { label: '', docId: null, anchor: 'Overview' } }]
        }
      ]
    }
    expect(tiptapToMarkdown(doc).trim()).toBe('[[#Overview]]')
  })

  it('round-trips anchored and same-note links idempotently', () => {
    expect(norm('[[Other Note#Heading]]').trim()).toBe('[[Other Note#Heading]]')
    expect(norm('[[#Overview]]').trim()).toBe('[[#Overview]]')
    expect(norm('[[Other Note]]').trim()).toBe('[[Other Note]]')
  })

  it('leaves a degenerate [[]] as literal text (not a wikiLink node)', () => {
    const inline = markdownToTiptap('a [[]] b').content[0].content ?? []
    expect(inline.every((n) => n.type !== 'wikiLink')).toBe(true)
  })
})

describe('tiptap doc round-trip (editor-shaped input)', () => {
  it('round-trips a doc through md and back to an equal doc', () => {
    const doc: TTDoc = markdownToTiptap(CORPUS.mixed)
    const md = tiptapToMarkdown(doc)
    const doc2 = markdownToTiptap(md)
    expect(doc2).toEqual(doc)
  })

  it('handles an empty document', () => {
    const doc = markdownToTiptap('')
    expect(doc).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })

  it('round-trips a doc containing a wikiLink back to an equal doc', () => {
    // Editor-shaped input carries a resolved docId; on reload it parses back with
    // docId null (resolution is the service layer's job, not the converter's).
    const doc: TTDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            { type: 'wikiLink', attrs: { label: 'Other Note', docId: 'abc-123' } },
            { type: 'text', text: ' here' }
          ]
        }
      ]
    }
    const md = tiptapToMarkdown(doc)
    expect(md.trim()).toBe('See [[Other Note]] here')
    const doc2 = markdownToTiptap(md)
    expect(doc2.content[0].content?.[1]).toEqual({
      type: 'wikiLink',
      attrs: { label: 'Other Note', docId: null, anchor: null }
    })
  })
})

describe('note file (frontmatter + body)', () => {
  it('round-trips frontmatter and body as a stable fixed point', () => {
    const raw =
      '---\nid: abc-123\ntitle: My Note\ncreated: 2026-06-24T10:00:00.000Z\n---\n\n# Hello\n\nWorld **bold**\n'
    const note = parseNoteFile(raw)
    expect(note.frontmatter.id).toBe('abc-123')
    expect(note.frontmatter.title).toBe('My Note')
    const out = serializeNoteFile(note)
    expect(serializeNoteFile(parseNoteFile(out))).toBe(out)
  })

  it('handles a body with no frontmatter', () => {
    const note = parseNoteFile('# Just a body\n')
    expect(note.frontmatter).toEqual({})
    expect(note.doc.content[0].type).toBe('heading')
  })

  it('does not lose content when frontmatter is malformed', () => {
    const raw = '---\nnot: [valid: yaml\n---\nbody'
    const note = parseNoteFile(raw)
    // malformed frontmatter is treated as body, so it parses without throwing
    expect(note.doc.content.length).toBeGreaterThan(0)
  })
})
