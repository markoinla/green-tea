import { Extension } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    collapsible: {
      toggleCollapse: () => ReturnType
    }
  }
}

export const Collapsible = Extension.create({
  name: 'collapsible',

  addCommands() {
    return {
      toggleCollapse:
        () =>
        ({ state, dispatch }) => {
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

          const node = $from.node(itemDepth)
          const pos = $from.before(itemDepth)

          if (dispatch) {
            dispatch(
              state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                collapsed: !node.attrs.collapsed
              })
            )
          }

          return true
        }
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-c': () => this.editor.commands.toggleCollapse()
    }
  }
})
