import { describe, it, expect } from 'vitest'
import {
  formatPickedSelection,
  parseEditCommit,
  isModeExitMessage,
  PICK_SELECTOR_MAX,
  PICK_TEXT_MAX,
  PICK_EDIT_TEXT_MAX,
  PICK_EDIT_PATH_MAX
} from './picker-selection'

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

describe('parseEditCommit', () => {
  it('parses a valid edit-commit into an EditCommit', () => {
    expect(
      parseEditCommit({
        source: 'gt-element-picker',
        type: 'edit-commit',
        path: [1, 0, 2],
        oldText: 'Welcome',
        newHTML: 'Welcome back'
      })
    ).toEqual({ path: [1, 0, 2], oldText: 'Welcome', newHTML: 'Welcome back' })
  })

  it('rejects a message with the wrong type', () => {
    expect(
      parseEditCommit({
        source: 'gt-element-picker',
        type: 'pick',
        path: [1, 0],
        oldText: 'a',
        newHTML: 'b'
      })
    ).toBeNull()
  })

  it('rejects a message from the wrong source', () => {
    expect(
      parseEditCommit({
        source: 'somethingelse',
        type: 'edit-commit',
        path: [1, 0],
        oldText: 'a',
        newHTML: 'b'
      })
    ).toBeNull()
  })

  it('rejects non-object / null payloads', () => {
    expect(parseEditCommit(null)).toBeNull()
    expect(parseEditCommit('edit-commit')).toBeNull()
    expect(parseEditCommit(undefined)).toBeNull()
  })

  it('rejects a missing, empty, or non-array path', () => {
    const base = { source: 'gt-element-picker', type: 'edit-commit', oldText: 'a', newHTML: 'b' }
    expect(parseEditCommit({ ...base, path: [] })).toBeNull()
    expect(parseEditCommit({ ...base, path: 'nope' })).toBeNull()
    expect(parseEditCommit(base)).toBeNull()
  })

  it('rejects a path containing non-integer or negative indices', () => {
    const base = { source: 'gt-element-picker', type: 'edit-commit', oldText: 'a', newHTML: 'b' }
    expect(parseEditCommit({ ...base, path: [1, -1] })).toBeNull()
    expect(parseEditCommit({ ...base, path: [1, 2.5] })).toBeNull()
    expect(parseEditCommit({ ...base, path: [1, '2'] })).toBeNull()
  })

  it('rejects a path deeper than the cap', () => {
    const base = { source: 'gt-element-picker', type: 'edit-commit', oldText: 'a', newHTML: 'b' }
    const tooDeep = new Array(PICK_EDIT_PATH_MAX + 1).fill(0)
    expect(parseEditCommit({ ...base, path: tooDeep })).toBeNull()
  })

  it('drops a no-op edit where newHTML is unchanged from oldText', () => {
    expect(
      parseEditCommit({
        source: 'gt-element-picker',
        type: 'edit-commit',
        path: [0],
        oldText: 'same',
        newHTML: 'same'
      })
    ).toBeNull()
  })

  it('drops an edit with empty newHTML', () => {
    expect(
      parseEditCommit({
        source: 'gt-element-picker',
        type: 'edit-commit',
        path: [0],
        oldText: 'gone',
        newHTML: ''
      })
    ).toBeNull()
  })

  it('clamps oversized oldText / newHTML to the shared caps', () => {
    const longOld = 'b'.repeat(PICK_EDIT_TEXT_MAX + 50)
    const longNew = 'c'.repeat(PICK_EDIT_TEXT_MAX + 50)
    expect(
      parseEditCommit({
        source: 'gt-element-picker',
        type: 'edit-commit',
        path: [1, 0],
        oldText: longOld,
        newHTML: longNew
      })
    ).toEqual({
      path: [1, 0],
      oldText: 'b'.repeat(PICK_EDIT_TEXT_MAX),
      newHTML: 'c'.repeat(PICK_EDIT_TEXT_MAX)
    })
  })

  it('coerces non-string text fields rather than trusting their type', () => {
    expect(
      parseEditCommit({
        source: 'gt-element-picker',
        type: 'edit-commit',
        path: [0],
        oldText: 1,
        newHTML: 2
      })
    ).toEqual({ path: [0], oldText: '1', newHTML: '2' })
  })
})

describe('isModeExitMessage', () => {
  it('accepts a well-formed mode-exit notification', () => {
    expect(isModeExitMessage({ source: 'gt-element-picker', type: 'mode-exit' })).toBe(true)
  })

  it('rejects the wrong source or type', () => {
    expect(isModeExitMessage({ source: 'somethingelse', type: 'mode-exit' })).toBe(false)
    expect(isModeExitMessage({ source: 'gt-element-picker', type: 'pick' })).toBe(false)
    expect(isModeExitMessage({ source: 'gt-element-picker', type: 'edit-commit' })).toBe(false)
  })

  it('rejects non-object / null payloads', () => {
    expect(isModeExitMessage(null)).toBe(false)
    expect(isModeExitMessage('mode-exit')).toBe(false)
    expect(isModeExitMessage(undefined)).toBe(false)
  })
})
