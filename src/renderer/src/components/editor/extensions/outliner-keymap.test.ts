import { describe, it, expect } from 'vitest'
import { Schema, Node as PMNode } from '@tiptap/pm/model'
import { EditorState, TextSelection, Transaction } from '@tiptap/pm/state'
import { moveItem } from './outliner-keymap'

const schema = new Schema({
  nodes: {
    doc: { content: 'outlinerList' },
    outlinerList: { content: 'outlinerItem+' },
    outlinerItem: { content: 'paragraph outlinerList?' },
    paragraph: { content: 'text*' },
    text: {}
  }
})

const p = (text: string): PMNode => schema.nodes.paragraph.create(null, schema.text(text))
const item = (...content: PMNode[]): PMNode => schema.nodes.outlinerItem.create(null, content)
const list = (...items: PMNode[]): PMNode => schema.nodes.outlinerList.create(null, items)

interface FakeEditor {
  view: {
    state: EditorState
    dispatch: (tr: Transaction) => void
  }
}

// Builds a doc with the given item texts and puts the caret inside the text of
// the item at `caretItemIndex`, returning a fake editor that records dispatch
function makeEditor(
  itemTexts: string[],
  caretItemIndex: number
): {
  editor: FakeEditor
  getDispatched: () => Transaction | null
} {
  const doc = schema.nodes.doc.create(null, list(...itemTexts.map((t) => item(p(t)))))

  // Locate a text position inside the target item's paragraph
  let caretPos = -1
  doc.descendants((node, pos) => {
    if (node.type.name === 'outlinerItem' && caretItemIndex-- === 0) {
      caretPos = pos + 2 // inside the paragraph
    }
    return caretPos === -1
  })
  expect(caretPos).toBeGreaterThan(-1)

  let state = EditorState.create({ doc, schema })
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, caretPos)))

  let dispatched: Transaction | null = null
  const editor: FakeEditor = {
    view: {
      state,
      dispatch: (tr) => {
        dispatched = tr
      }
    }
  }
  return { editor, getDispatched: () => dispatched }
}

const itemTexts = (doc: PMNode): string[] => {
  const texts: string[] = []
  doc.descendants((node) => {
    if (node.type.name === 'outlinerItem') texts.push(node.textContent)
  })
  return texts
}

describe('moveItem', () => {
  it('swaps the current item with the one above on move up', () => {
    const { editor, getDispatched } = makeEditor(['first', 'second', 'third'], 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(moveItem(editor as any, 'up')).toBe(true)
    const tr = getDispatched()
    expect(tr).not.toBeNull()
    expect(itemTexts(tr!.doc)).toEqual(['second', 'first', 'third'])
  })

  it('swaps the current item with the one below on move down', () => {
    const { editor, getDispatched } = makeEditor(['first', 'second', 'third'], 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(moveItem(editor as any, 'down')).toBe(true)
    const tr = getDispatched()
    expect(tr).not.toBeNull()
    expect(itemTexts(tr!.doc)).toEqual(['first', 'third', 'second'])
  })

  it('places the caret at a valid text position inside the moved item', () => {
    for (const direction of ['up', 'down'] as const) {
      const { editor, getDispatched } = makeEditor(['first', 'second', 'third'], 1)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      moveItem(editor as any, direction)
      const tr = getDispatched()!
      const sel = tr.selection
      expect(sel).toBeInstanceOf(TextSelection)
      // The caret must sit inside a textblock (the paragraph), not between
      // the item boundary and its first child
      expect(sel.$from.parent.isTextblock).toBe(true)
      expect(sel.$from.parent.type.name).toBe('paragraph')
      // ...and inside the item that moved (the one the caret started in)
      expect(sel.$from.node(-1).textContent).toBe('second')
    }
  })

  it('returns false when moving the first item up or the last item down', () => {
    const first = makeEditor(['first', 'second'], 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(moveItem(first.editor as any, 'up')).toBe(false)
    expect(first.getDispatched()).toBeNull()

    const last = makeEditor(['first', 'second'], 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(moveItem(last.editor as any, 'down')).toBe(false)
    expect(last.getDispatched()).toBeNull()
  })
})
