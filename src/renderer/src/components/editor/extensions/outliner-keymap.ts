import { Extension } from '@tiptap/core'

export const OutlinerKeymap = Extension.create({
  name: 'outlinerKeymap',

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        return this.editor.commands.sinkListItem('outlinerItem')
      },
      'Shift-Tab': () => {
        return this.editor.commands.liftListItem('outlinerItem')
      },
      'Mod-Shift-ArrowUp': () => {
        return moveItem(this.editor, 'up')
      },
      'Mod-Shift-ArrowDown': () => {
        return moveItem(this.editor, 'down')
      }
    }
  }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function moveItem(editor: any, direction: 'up' | 'down'): boolean {
  const { state, dispatch } = editor.view
  const { $from } = state.selection

  // Find the outlinerItem node around the cursor
  let itemDepth = -1
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === 'outlinerItem') {
      itemDepth = d
      break
    }
  }

  if (itemDepth < 0) return false

  const parent = $from.node(itemDepth - 1)
  const itemIndex = $from.index(itemDepth - 1)

  if (direction === 'up' && itemIndex === 0) return false
  if (direction === 'down' && itemIndex >= parent.childCount - 1) return false

  const siblingIndex = direction === 'up' ? itemIndex - 1 : itemIndex + 1

  // Calculate positions
  const parentStart = $from.start(itemDepth - 1)
  let offset = 0
  for (let i = 0; i < Math.min(itemIndex, siblingIndex); i++) {
    offset += parent.child(i).nodeSize
  }

  const firstPos = parentStart + offset
  const firstNode = parent.child(Math.min(itemIndex, siblingIndex))
  const secondNode = parent.child(Math.max(itemIndex, siblingIndex))
  const secondPos = firstPos + firstNode.nodeSize

  if (dispatch) {
    const tr = state.tr

    // Replace the two adjacent items by swapping them
    tr.replaceWith(firstPos, secondPos + secondNode.nodeSize, [
      secondNode.copy(secondNode.content),
      firstNode.copy(firstNode.content)
    ])

    // Adjust selection to follow the moved item
    const newItemPos = direction === 'up' ? firstPos : firstPos + secondNode.nodeSize

    tr.setSelection(
      state.selection.constructor.create(tr.doc, newItemPos + 1) as typeof state.selection
    )
    dispatch(tr)
  }

  return true
}
