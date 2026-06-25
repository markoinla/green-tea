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
