import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { type Editor, useEditorState } from '@tiptap/react'
import type { CanCommands, ChainedCommands } from '@tiptap/core'
import { tableCellMenuPluginKey } from './extensions/table-cell-menu'
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  EllipsisVertical,
  Merge,
  Rows3,
  Split,
  TableIcon,
  Trash2
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'

interface TableCellDropdownMenuProps {
  editor: Editor | null
}

function canRun(
  editor: Editor,
  command: (chain: ReturnType<CanCommands['chain']>) => ChainedCommands
) {
  return command(editor.can().chain().focus()).run()
}

function run(editor: Editor, command: (chain: ChainedCommands) => ChainedCommands) {
  command(editor.chain().focus()).run()
}

export function TableCellDropdownMenu({ editor }: TableCellDropdownMenuProps) {
  // We maintain a stable wrapper div that we manually append/remove from the
  // ProseMirror-managed cell DOM. React portals into this wrapper so that when
  // ProseMirror destroys/recreates the <td>/<th>, React isn't left trying to
  // unmount children from a detached node.
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)

  const cellPos = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) return null
      return tableCellMenuPluginKey.getState(ctx.editor.state)?.cellPos ?? null
    }
  })

  useEffect(() => {
    if (!editor || cellPos === null) {
      setPortalContainer(null)
      return
    }
    const dom = editor.view.nodeDOM(cellPos)
    if (!(dom instanceof HTMLElement)) {
      setPortalContainer(null)
      return
    }

    const wrapper = document.createElement('div')
    wrapper.className = 'table-cell-menu-trigger'
    wrapper.setAttribute('contenteditable', 'false')
    dom.appendChild(wrapper)
    setPortalContainer(wrapper)

    return () => {
      // Only remove if the wrapper is still a child of the cell
      if (wrapper.parentNode === dom) {
        dom.removeChild(wrapper)
      }
      setPortalContainer(null)
    }
  }, [editor, cellPos])

  const editorState = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) return null
      const e = ctx.editor
      return {
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

  const handleAction = useCallback(
    (command: (chain: ChainedCommands) => ChainedCommands) => {
      if (!editor) return
      run(editor, command)
    },
    [editor]
  )

  if (!editor || !editorState || !portalContainer) return null

  return createPortal(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="table-cell-menu-button"
          aria-label="Table cell options"
          onMouseDown={(e) => e.preventDefault()}
        >
          <EllipsisVertical className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem
          onSelect={() => handleAction((chain) => chain.addRowBefore())}
          disabled={!editorState.canAddRowBefore}
        >
          <ArrowUpToLine className="size-4" />
          Insert row above
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => handleAction((chain) => chain.addRowAfter())}
          disabled={!editorState.canAddRowAfter}
        >
          <ArrowDownToLine className="size-4" />
          Insert row below
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => handleAction((chain) => chain.addColumnBefore())}
          disabled={!editorState.canAddColumnBefore}
        >
          <ArrowLeftToLine className="size-4" />
          Insert column before
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => handleAction((chain) => chain.addColumnAfter())}
          disabled={!editorState.canAddColumnAfter}
        >
          <ArrowRightToLine className="size-4" />
          Insert column after
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => handleAction((chain) => chain.toggleHeaderRow())}
          disabled={!editorState.canToggleHeaderRow}
        >
          <Rows3 className="size-4" />
          Toggle header row
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => handleAction((chain) => chain.toggleHeaderColumn())}
          disabled={!editorState.canToggleHeaderColumn}
        >
          <Columns3 className="size-4" />
          Toggle header column
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => handleAction((chain) => chain.mergeCells())}
          disabled={!editorState.canMergeCells}
        >
          <Merge className="size-4" />
          Merge cells
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => handleAction((chain) => chain.splitCell())}
          disabled={!editorState.canSplitCell}
        >
          <Split className="size-4" />
          Split cell
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          onSelect={() => handleAction((chain) => chain.deleteRow())}
          disabled={!editorState.canDeleteRow}
        >
          <Trash2 className="size-4" />
          Delete row
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => handleAction((chain) => chain.deleteColumn())}
          disabled={!editorState.canDeleteColumn}
        >
          <Trash2 className="size-4" />
          Delete column
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => handleAction((chain) => chain.deleteTable())}
          disabled={!editorState.canDeleteTable}
        >
          <TableIcon className="size-4" />
          Delete table
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
    portalContainer
  )
}
