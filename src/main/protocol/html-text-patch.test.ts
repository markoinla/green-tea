import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { patchHtmlText } from './html-text-patch'

function doc(html: string) {
  return parseHTML(html).document
}

/**
 * Child-index path (from documentElement) to the element matched by `selector`,
 * mirroring the frame's computePath. Only needed to supply the duplicate-text
 * tiebreaker in tests — the primary locator is the text itself.
 */
function pathTo(html: string, selector: string): number[] {
  const target = doc(html).querySelector(selector)
  if (!target) throw new Error(`test fixture has no ${selector}`)
  const indices: number[] = []
  let cur: Element | null = target
  while (cur && cur.parentElement) {
    const siblings = cur.parentElement.children
    let idx = -1
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i] === cur) {
        idx = i
        break
      }
    }
    indices.unshift(idx)
    cur = cur.parentElement
  }
  return indices
}

describe('patchHtmlText', () => {
  it('patches the block whose text matches oldText', () => {
    const html = '<html><body><div><p id="hero">old value</p></div></body></html>'
    const out = patchHtmlText(html, {
      path: pathTo(html, '#hero'),
      oldText: 'old value',
      newHTML: 'new value'
    })
    expect(doc(out).querySelector('#hero')!.textContent).toBe('new value')
  })

  it('edits a paragraph with inline children, preserving formatting via innerHTML', () => {
    // The reported bug: a <p> with a child <b> could not be edited as a whole.
    const html = '<html><body><p id="t">Hello <b>world</b></p></body></html>'
    const out = patchHtmlText(html, {
      path: pathTo(html, '#t'),
      oldText: 'Hello world',
      newHTML: 'Hello <b>brave</b> world'
    })
    const p = doc(out).querySelector('#t')!
    expect(p.textContent).toBe('Hello brave world')
    expect(p.querySelector('b')!.textContent).toBe('brave')
  })

  it('targets the block, not its inline child, when matching text', () => {
    // Only the <p> (block) is a candidate; the inner <b> is inline and excluded,
    // so "Hello world" resolves to exactly one element with no path tiebreaker.
    const html = '<html><body><p>Hello <b>world</b></p></body></html>'
    const out = patchHtmlText(html, { path: [], oldText: 'Hello world', newHTML: 'Goodbye' })
    expect(doc(out).querySelector('p')!.textContent).toBe('Goodbye')
  })

  it('matches by text even when the index path is wrong (text is the primary key)', () => {
    const html = '<html><body><h1>Unique Heading</h1></body></html>'
    const out = patchHtmlText(html, {
      path: [9, 9, 9],
      oldText: 'Unique Heading',
      newHTML: 'Renamed'
    })
    expect(doc(out).querySelector('h1')!.textContent).toBe('Renamed')
  })

  it('refuses when no block matches (script-generated text / stale edit)', () => {
    const html = '<html><body><p class="sf">Ateardown of the thing.</p></body></html>'
    expect(() =>
      patchHtmlText(html, {
        path: [1, 0],
        oldText: 'An April Dunford framework teardown of the thing.',
        newHTML: 'x'
      })
    ).toThrow('no longer matches the saved file')
  })

  it('compares after normalization (whitespace-insensitive)', () => {
    const html = '<html><body><p id="t">  hello   world\n</p></body></html>'
    const out = patchHtmlText(html, {
      path: pathTo(html, '#t'),
      oldText: 'hello world',
      newHTML: 'goodbye world'
    })
    expect(doc(out).querySelector('#t')!.textContent).toBe('goodbye world')
  })

  it('disambiguates duplicate text by the index path', () => {
    const html = '<html><body><ul><li>same</li><li>same</li><li>same</li></ul></body></html>'
    const out = patchHtmlText(html, {
      path: pathTo(html, 'li:nth-of-type(2)'),
      oldText: 'same',
      newHTML: 'SECOND'
    })
    const items = doc(out).querySelectorAll('li')
    expect(items[0].textContent).toBe('same')
    expect(items[1].textContent).toBe('SECOND')
    expect(items[2].textContent).toBe('same')
  })

  it('refuses duplicate text when the path matches none of them', () => {
    const html = '<html><body><ul><li>same</li><li>same</li></ul></body></html>'
    expect(() => patchHtmlText(html, { path: [7, 7, 7], oldText: 'same', newHTML: 'x' })).toThrow(
      'appears more than once'
    )
  })

  it('ignores <style>/<script>, picking the visible block', () => {
    const html = '<html><body><style>keepme</style><p>keepme</p></body></html>'
    const out = patchHtmlText(html, {
      path: pathTo(html, 'p'),
      oldText: 'keepme',
      newHTML: 'changed'
    })
    const d = doc(out)
    expect(d.querySelector('p')!.textContent).toBe('changed')
    expect(d.querySelector('style')!.textContent).toBe('keepme')
  })

  it('refuses a container that holds block-level children (too coarse a target)', () => {
    // <div> wraps two <p> blocks; its combined text must never resolve to the div.
    const html = '<html><body><div><p>one</p><p>two</p></div></body></html>'
    expect(() =>
      patchHtmlText(html, { path: [1, 0], oldText: 'onetwo', newHTML: 'x' })
    ).toThrow('no longer matches the saved file')
  })

  it('preserves other markup and attributes (inline anchor round-trips in innerHTML)', () => {
    const html =
      '<html><body><header data-keep="1">Top</header>' +
      '<main><a id="link" href="https://example.com" class="btn primary">click me</a></main>' +
      '<footer>Bottom</footer></body></html>'
    // The editable block is <main> (the inline <a> is not an edit target on its
    // own); contenteditable preserves the anchor, so newHTML carries it back.
    const out = patchHtmlText(html, {
      path: pathTo(html, 'main'),
      oldText: 'click me',
      newHTML: '<a id="link" href="https://example.com" class="btn primary">tap here</a>'
    })
    const d = doc(out)
    const link = d.querySelector('#link')!
    expect(link.textContent).toBe('tap here')
    expect(link.getAttribute('href')).toBe('https://example.com')
    expect(link.getAttribute('class')).toBe('btn primary')
    expect(d.querySelector('header')!.getAttribute('data-keep')).toBe('1')
    expect(d.querySelector('footer')!.textContent).toBe('Bottom')
  })
})
