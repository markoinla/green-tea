import { type Editor, useEditorState } from '@tiptap/react'
import type { CanCommands, ChainedCommands } from '@tiptap/core'

export type TableCommandState = {
  isInTable: boolean
  canAddRowBefore: boolean
  canAddRowAfter: boolean
  canDeleteRow: boolean
  canAddColumnBefore: boolean
  canAddColumnAfter: boolean
  canDeleteColumn: boolean
  canToggleHeaderRow: boolean
  canToggleHeaderColumn: boolean
  canMergeCells: boolean
  canSplitCell: boolean
  canDeleteTable: boolean
}

function canRun(
  editor: Editor,
  command: (chain: ReturnType<CanCommands['chain']>) => ChainedCommands
) {
  return command(editor.can().chain().focus()).run()
}

/**
 * Live enabled/disabled state for the table commands.
 *
 * This MUST go through `useEditorState` rather than being computed inline while
 * rendering a menu: `useEditor` does not re-render on transactions (Tiptap v3
 * `shouldRerenderOnTransaction` defaults to off), so an inline computation is
 * frozen at whatever the selection was the last time the menu component
 * happened to re-render — which made "delete row/column/table" render disabled
 * (and therefore silently ignore clicks) one interaction behind reality.
 */
export function useTableCommandState(editor: Editor | null): TableCommandState | null {
  return useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor
      if (!e) return null
      return {
        isInTable: e.isActive('table'),
        canAddRowBefore: canRun(e, (chain) => chain.addRowBefore()),
        canAddRowAfter: canRun(e, (chain) => chain.addRowAfter()),
        canDeleteRow: canRun(e, (chain) => chain.deleteRow()),
        canAddColumnBefore: canRun(e, (chain) => chain.addColumnBefore()),
        canAddColumnAfter: canRun(e, (chain) => chain.addColumnAfter()),
        canDeleteColumn: canRun(e, (chain) => chain.deleteColumn()),
        canToggleHeaderRow: canRun(e, (chain) => chain.toggleHeaderRow()),
        canToggleHeaderColumn: canRun(e, (chain) => chain.toggleHeaderColumn()),
        canMergeCells: canRun(e, (chain) => chain.mergeCells()),
        canSplitCell: canRun(e, (chain) => chain.splitCell()),
        canDeleteTable: canRun(e, (chain) => chain.deleteTable())
      }
    }
  })
}

export function runTableCommand(
  editor: Editor | null,
  command: (chain: ChainedCommands) => ChainedCommands
) {
  if (!editor) return
  command(editor.chain().focus()).run()
}
