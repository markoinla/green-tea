import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type Editor, useEditorState } from '@tiptap/react'
import type { ChainedCommands } from '@tiptap/core'
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
import { runTableCommand, useTableCommandState } from './table-commands'

interface TableCellDropdownMenuProps {
  editor: Editor | null
}

type Position = { top: number; left: number }

// Distance from the cell's top-right corner, matching the old in-cell offsets.
const OFFSET = 2
const BUTTON_SIZE = 20

export function TableCellDropdownMenu({ editor }: TableCellDropdownMenuProps) {
  // The trigger is rendered into `document.body` and positioned over the cell
  // rather than appended into the cell's DOM. ProseMirror owns the children of
  // every <td>/<th> and strips anything it did not create on the next redraw
  // (prosemirror-view `renderDescs` removes trailing unknown nodes), which used
  // to leave React portaling into a detached node and the button unclickable.
  const [position, setPosition] = useState<Position | null>(null)
  const openRef = useRef(false)

  const cellPos = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) return null
      return tableCellMenuPluginKey.getState(ctx.editor.state)?.cellPos ?? null
    }
  })

  const commands = useTableCommandState(editor)

  const updatePosition = useCallback(() => {
    // Never move or unmount the trigger while its menu is open — the open menu
    // is a child of this portal and deleting a row/column/table would otherwise
    // tear it down in the middle of its own `onSelect`.
    if (openRef.current) return
    if (!editor || cellPos === null) {
      setPosition((prev) => (prev === null ? prev : null))
      return
    }

    let dom: Node | null = null
    try {
      dom = editor.view.nodeDOM(cellPos)
    } catch {
      dom = null
    }
    if (!(dom instanceof HTMLElement) || !dom.isConnected) {
      setPosition((prev) => (prev === null ? prev : null))
      return
    }

    const cell = dom.getBoundingClientRect()
    // Hide when the cell is scrolled out of the editor's viewport.
    const scroller = editor.view.dom.closest('.overflow-auto')
    if (scroller) {
      const bounds = scroller.getBoundingClientRect()
      if (cell.bottom < bounds.top || cell.top > bounds.bottom) {
        setPosition((prev) => (prev === null ? prev : null))
        return
      }
    }

    const top = cell.top + OFFSET
    const left = cell.right - BUTTON_SIZE - OFFSET
    setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }))
  }, [editor, cellPos])

  useLayoutEffect(() => {
    updatePosition()
  }, [updatePosition])

  useEffect(() => {
    if (!editor) return
    const handle = () => updatePosition()
    // `transaction` fires after the view has already written the new DOM, so
    // measuring here reflects the post-edit layout.
    editor.on('transaction', handle)
    window.addEventListener('resize', handle)
    window.addEventListener('scroll', handle, true)
    return () => {
      editor.off('transaction', handle)
      window.removeEventListener('resize', handle)
      window.removeEventListener('scroll', handle, true)
    }
  }, [editor, updatePosition])

  const handleAction = useCallback(
    (command: (chain: ChainedCommands) => ChainedCommands) => {
      runTableCommand(editor, command)
    },
    [editor]
  )

  const handleOpenChange = useCallback(
    (open: boolean) => {
      openRef.current = open
      if (!open) updatePosition()
    },
    [updatePosition]
  )

  if (!editor || !commands || !position) return null

  return createPortal(
    <div
      className="table-cell-menu-trigger"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button type="button" className="table-cell-menu-button" aria-label="Table cell options">
            <EllipsisVertical className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem
            onSelect={() => handleAction((chain) => chain.addRowBefore())}
            disabled={!commands.canAddRowBefore}
          >
            <ArrowUpToLine className="size-4" />
            Insert row above
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => handleAction((chain) => chain.addRowAfter())}
            disabled={!commands.canAddRowAfter}
          >
            <ArrowDownToLine className="size-4" />
            Insert row below
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => handleAction((chain) => chain.addColumnBefore())}
            disabled={!commands.canAddColumnBefore}
          >
            <ArrowLeftToLine className="size-4" />
            Insert column before
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => handleAction((chain) => chain.addColumnAfter())}
            disabled={!commands.canAddColumnAfter}
          >
            <ArrowRightToLine className="size-4" />
            Insert column after
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => handleAction((chain) => chain.toggleHeaderRow())}
            disabled={!commands.canToggleHeaderRow}
          >
            <Rows3 className="size-4" />
            Toggle header row
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => handleAction((chain) => chain.toggleHeaderColumn())}
            disabled={!commands.canToggleHeaderColumn}
          >
            <Columns3 className="size-4" />
            Toggle header column
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => handleAction((chain) => chain.mergeCells())}
            disabled={!commands.canMergeCells}
          >
            <Merge className="size-4" />
            Merge cells
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => handleAction((chain) => chain.splitCell())}
            disabled={!commands.canSplitCell}
          >
            <Split className="size-4" />
            Split cell
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            variant="destructive"
            onSelect={() => handleAction((chain) => chain.deleteRow())}
            disabled={!commands.canDeleteRow}
          >
            <Trash2 className="size-4" />
            Delete row
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => handleAction((chain) => chain.deleteColumn())}
            disabled={!commands.canDeleteColumn}
          >
            <Trash2 className="size-4" />
            Delete column
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => handleAction((chain) => chain.deleteTable())}
            disabled={!commands.canDeleteTable}
          >
            <TableIcon className="size-4" />
            Delete table
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>,
    document.body
  )
}
