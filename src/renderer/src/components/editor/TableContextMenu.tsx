import { useState, useCallback, type MouseEvent } from 'react'
import { type Editor } from '@tiptap/react'
import type { ChainedCommands } from '@tiptap/core'
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  Merge,
  Rows3,
  Split,
  TableIcon,
  Trash2
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { runTableCommand, useTableCommandState } from './table-commands'

interface TableContextMenuProps {
  editor: Editor | null
  children: React.ReactNode
}

export function TableContextMenu({ editor, children }: TableContextMenuProps) {
  const [rightClickedInTable, setRightClickedInTable] = useState(false)

  // Recomputed on every transaction, so the `disabled` flags below reflect the
  // selection that `handleContextMenu` just set rather than the previous one.
  const commands = useTableCommandState(editor)

  const run = useCallback(
    (command: (chain: ChainedCommands) => ChainedCommands) => {
      runTableCommand(editor, command)
    },
    [editor]
  )

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!editor) return

      const target = event.target as HTMLElement | null
      setRightClickedInTable(Boolean(target?.closest('table,th,td')))

      const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
      if (pos?.pos != null) {
        editor.chain().focus().setTextSelection(pos.pos).run()
      }
    },
    [editor]
  )

  if (!editor) {
    return <>{children}</>
  }

  const isInTable = rightClickedInTable || Boolean(commands?.isInTable)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={handleContextMenu}>
        {children}
      </ContextMenuTrigger>
      {isInTable && commands && (
        <ContextMenuContent className="w-56">
          {/* Insert section */}
          <ContextMenuItem
            onSelect={() => run((chain) => chain.addRowBefore())}
            disabled={!commands.canAddRowBefore}
          >
            <ArrowUpToLine className="size-4" />
            Insert row above
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => run((chain) => chain.addRowAfter())}
            disabled={!commands.canAddRowAfter}
          >
            <ArrowDownToLine className="size-4" />
            Insert row below
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => run((chain) => chain.addColumnBefore())}
            disabled={!commands.canAddColumnBefore}
          >
            <ArrowLeftToLine className="size-4" />
            Insert column before
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => run((chain) => chain.addColumnAfter())}
            disabled={!commands.canAddColumnAfter}
          >
            <ArrowRightToLine className="size-4" />
            Insert column after
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Headers section */}
          <ContextMenuItem
            onSelect={() => run((chain) => chain.toggleHeaderRow())}
            disabled={!commands.canToggleHeaderRow}
          >
            <Rows3 className="size-4" />
            Toggle header row
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => run((chain) => chain.toggleHeaderColumn())}
            disabled={!commands.canToggleHeaderColumn}
          >
            <Columns3 className="size-4" />
            Toggle header column
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Merge/Split section */}
          <ContextMenuItem
            onSelect={() => run((chain) => chain.mergeCells())}
            disabled={!commands.canMergeCells}
          >
            <Merge className="size-4" />
            Merge cells
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => run((chain) => chain.splitCell())}
            disabled={!commands.canSplitCell}
          >
            <Split className="size-4" />
            Split cell
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Delete section */}
          <ContextMenuItem
            variant="destructive"
            onSelect={() => run((chain) => chain.deleteRow())}
            disabled={!commands.canDeleteRow}
          >
            <Trash2 className="size-4" />
            Delete row
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onSelect={() => run((chain) => chain.deleteColumn())}
            disabled={!commands.canDeleteColumn}
          >
            <Trash2 className="size-4" />
            Delete column
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onSelect={() => run((chain) => chain.deleteTable())}
            disabled={!commands.canDeleteTable}
          >
            <TableIcon className="size-4" />
            Delete table
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}
