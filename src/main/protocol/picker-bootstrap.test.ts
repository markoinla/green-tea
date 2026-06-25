import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { buildSelector, PICKER_BOOTSTRAP_SCRIPT, PICKER_BOOTSTRAP_MARKER } from './picker-bootstrap'

function doc(html: string) {
  return parseHTML(`<html><body>${html}</body></html>`).document
}

describe('buildSelector', () => {
  it('returns "" for a null/invalid element', () => {
    expect(buildSelector(null as unknown as Element)).toBe('')
  })

  it('uses #id for an element with a unique id', () => {
    const d = doc('<div><span id="hero">x</span></div>')
    const el = d.querySelector('#hero')!
    expect(buildSelector(el)).toBe('#hero')
  })

  it('includes tag.class for a classed element', () => {
    const d = doc('<section><h2 class="title big">Hi</h2></section>')
    const el = d.querySelector('h2')!
    const sel = buildSelector(el)
    expect(sel).toContain('h2.title')
  })

  it('caps classes at two', () => {
    const d = doc('<p class="a b c d">x</p>')
    const el = d.querySelector('p')!
    const sel = buildSelector(el)
    expect(sel).toContain('p.a.b')
    expect(sel).not.toContain('p.a.b.c')
  })

  it('adds :nth-of-type(n) for ambiguous same-tag siblings', () => {
    const d = doc('<ul><li>one</li><li>two</li><li>three</li></ul>')
    const items = d.querySelectorAll('li')
    const second = items[1]
    const sel = buildSelector(second)
    expect(sel).toContain('li:nth-of-type(2)')
  })

  it('omits :nth-of-type for a lone same-tag child', () => {
    const d = doc('<div><a>only</a></div>')
    const el = d.querySelector('a')!
    expect(buildSelector(el)).not.toContain(':nth-of-type')
  })

  it('caps the walk at 5 segments (depth cap)', () => {
    const d = doc(
      '<div><div><div><div><div><div><div><span>deep</span></div></div></div></div></div></div></div>'
    )
    const el = d.querySelector('span')!
    const sel = buildSelector(el)
    const segments = sel.split(' > ')
    expect(segments.length).toBeLessThanOrEqual(5)
  })

  it('stops at and excludes body/html', () => {
    const d = doc('<main><p>x</p></main>')
    const el = d.querySelector('p')!
    const sel = buildSelector(el)
    expect(sel).not.toContain('body')
    expect(sel).not.toContain('html')
  })
})

describe('PICKER_BOOTSTRAP_SCRIPT', () => {
  it('contains the marker, the source string, and a <script tag', () => {
    expect(PICKER_BOOTSTRAP_SCRIPT).toContain(PICKER_BOOTSTRAP_MARKER)
    expect(PICKER_BOOTSTRAP_SCRIPT).toContain('gt-element-picker')
    expect(PICKER_BOOTSTRAP_SCRIPT).toContain('<script')
  })
})
