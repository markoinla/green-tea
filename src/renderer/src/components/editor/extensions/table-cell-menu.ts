import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface TableCellMenuState {
  cellPos: number | null
}

export const tableCellMenuPluginKey = new PluginKey<TableCellMenuState>('tableCellMenu')

export const TableCellMenu = Extension.create({
  name: 'tableCellMenu',

  addProseMirrorPlugins() {
    return [
      new Plugin<TableCellMenuState>({
        key: tableCellMenuPluginKey,
        state: {
          init() {
            return { cellPos: null }
          },
          apply(tr, prev) {
            const sel = tr.selection
            const $from = sel.$from

            for (let d = $from.depth; d >= 0; d--) {
              const node = $from.node(d)
              if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
                const pos = $from.before(d)
                if (pos === prev.cellPos) return prev
                return { cellPos: pos }
              }
            }

            if (prev.cellPos === null) return prev
            return { cellPos: null }
          }
        }
      })
    ]
  }
})
