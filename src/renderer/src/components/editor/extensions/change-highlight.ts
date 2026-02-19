import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const changeHighlightKey = new PluginKey('changeHighlight')

const FADE_DURATION_MS = 2000

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    changeHighlight: {
      /** Highlight nodes at the given positions, then fade them out. */
      highlightChanges: (positions: number[]) => ReturnType
    }
  }
}

export const ChangeHighlight = Extension.create({
  name: 'changeHighlight',

  addCommands() {
    return {
      highlightChanges:
        (positions: number[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(changeHighlightKey, { positions })
            dispatch(tr)
          }
          return true
        }
    }
  },

  addProseMirrorPlugins() {
    let fadeTimeout: ReturnType<typeof setTimeout> | null = null

    return [
      new Plugin({
        key: changeHighlightKey,

        state: {
          init() {
            return DecorationSet.empty
          },

          apply(tr, oldDecorations) {
            const meta = tr.getMeta(changeHighlightKey)

            if (meta?.clear) {
              return DecorationSet.empty
            }

            if (meta?.positions) {
              const decorations: Decoration[] = []
              const doc = tr.doc

              for (const pos of meta.positions as number[]) {
                if (pos < 0 || pos >= doc.content.size) continue
                const node = doc.nodeAt(pos)
                if (!node) continue
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: 'change-highlight'
                  })
                )
              }

              return DecorationSet.create(doc, decorations)
            }

            if (tr.docChanged) {
              return oldDecorations.map(tr.mapping, tr.doc)
            }

            return oldDecorations
          }
        },

        props: {
          decorations(state) {
            return this.getState(state) ?? DecorationSet.empty
          }
        },

        view(editorView) {
          return {
            update(view, prevState) {
              const decos = changeHighlightKey.getState(view.state)
              const prevDecos = changeHighlightKey.getState(prevState)

              if (decos !== prevDecos && decos && decos !== DecorationSet.empty) {
                // Schedule clearing after the CSS animation finishes
                if (fadeTimeout) clearTimeout(fadeTimeout)
                fadeTimeout = setTimeout(() => {
                  const tr = editorView.state.tr.setMeta(changeHighlightKey, { clear: true })
                  editorView.dispatch(tr)
                  fadeTimeout = null
                }, FADE_DURATION_MS)
              }
            },

            destroy() {
              if (fadeTimeout) clearTimeout(fadeTimeout)
            }
          }
        }
      })
    ]
  }
})
