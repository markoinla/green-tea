import { describe, it, expect } from 'vitest'
import { formatPickedSelection, PICK_SELECTOR_MAX, PICK_TEXT_MAX } from './picker-selection'

describe('formatPickedSelection', () => {
  it('formats a valid pick with text as selector + quoted excerpt', () => {
    expect(
      formatPickedSelection({
        source: 'gt-element-picker',
        type: 'pick',
        selector: 'h2.hero-title',
        text: 'Welcome to our store'
      })
    ).toBe('Selected element: h2.hero-title  ("Welcome to our store")')
  })

  it('omits the parenthetical when there is no text', () => {
    expect(
      formatPickedSelection({ source: 'gt-element-picker', type: 'pick', selector: 'main > div' })
    ).toBe('Selected element: main > div')
  })

  it('rejects a message from the wrong source', () => {
    expect(
      formatPickedSelection({ source: 'somethingelse', type: 'pick', selector: 'h2' })
    ).toBeNull()
  })

  it('rejects a message with the wrong type', () => {
    expect(
      formatPickedSelection({ source: 'gt-element-picker', type: 'set-inspect', selector: 'h2' })
    ).toBeNull()
  })

  it('rejects non-object / null / empty-selector payloads', () => {
    expect(formatPickedSelection(null)).toBeNull()
    expect(formatPickedSelection('pick')).toBeNull()
    expect(formatPickedSelection(undefined)).toBeNull()
    expect(
      formatPickedSelection({ source: 'gt-element-picker', type: 'pick', selector: '' })
    ).toBeNull()
  })

  it('re-clamps an oversized selector and text to the shared caps', () => {
    const longSelector = 'a'.repeat(PICK_SELECTOR_MAX + 50)
    const longText = 'b'.repeat(PICK_TEXT_MAX + 50)
    const out = formatPickedSelection({
      source: 'gt-element-picker',
      type: 'pick',
      selector: longSelector,
      text: longText
    })
    expect(out).toBe(
      `Selected element: ${'a'.repeat(PICK_SELECTOR_MAX)}  ("${'b'.repeat(PICK_TEXT_MAX)}")`
    )
  })

  it('coerces non-string fields rather than trusting their type', () => {
    // A forged message could send non-strings; we String()-coerce defensively.
    const out = formatPickedSelection({
      source: 'gt-element-picker',
      type: 'pick',
      selector: 'div',
      text: 42
    })
    expect(out).toBe('Selected element: div  ("42")')
  })
})
