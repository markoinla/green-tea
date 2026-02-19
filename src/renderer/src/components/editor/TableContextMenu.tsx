import { useState, useCallback, type MouseEvent } from 'react'
import { type Editor } from '@tiptap/react'
import type { CanCommands, ChainedCommands } from '@tiptap/core'
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

interface TableContextMenuProps {
  editor: Editor | null
  children: React.ReactNode
}

export function TableContextMenu({ editor, children }: TableContextMenuProps) {
  const [isInTable, setIsInTable] = useState(false)

  const canRun = useCallback(
    (command: (chain: ReturnType<CanCommands['chain']>) => ChainedCommands) => {
      if (!editor) return false
      return command(editor.can().chain().focus()).run()
    },
    [editor]
  )

  const run = useCallback(
    (command: (chain: ChainedCommands) => ChainedCommands) => {
      if (!editor) return
      command(editor.chain().focus()).run()
    },
    [editor]
  )

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!editor) return

      const target = event.target as HTMLElement | null
      const inTableByTarget = Boolean(target?.closest('table,th,td'))
      setIsInTable(inTableByTarget || editor.isActive('table'))

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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={handleContextMenu}>
        {children}
      </ContextMenuTrigger>
      {isInTable && (
        <ContextMenuContent className="w-56">
          {/* Insert section */}
          <ContextMenuItem
            onSelect={() => run((chain) => chain.addRowBefore())}
            disabled={!canRun((chain) => chain.addRowBefore())}
          >
            <ArrowUpToLine className="size-4" />
            Insert row above
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => run((chain) => chain.addRowAfter())}
            disabled={!canRun((chain) => chain.addRowAfter())}
          >
            <ArrowDownToLine className="size-4" />
            Insert row below
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => run((chain) => chain.addColumnBefore())}
            disabled={!canRun((chain) => chain.addColumnBefore())}
          >
            <ArrowLeftToLine className="size-4" />
            Insert column before
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => run((chain) => chain.addColumnAfter())}
            disabled={!canRun((chain) => chain.addColumnAfter())}
          >
            <ArrowRightToLine className="size-4" />
            Insert column after
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Headers section */}
          <ContextMenuItem
            onSelect={() => run((chain) => chain.toggleHeaderRow())}
            disabled={!canRun((chain) => chain.toggleHeaderRow())}
          >
            <Rows3 className="size-4" />
            Toggle header row
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => run((chain) => chain.toggleHeaderColumn())}
            disabled={!canRun((chain) => chain.toggleHeaderColumn())}
          >
            <Columns3 className="size-4" />
            Toggle header column
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Merge/Split section */}
          <ContextMenuItem
            onSelect={() => run((chain) => chain.mergeCells())}
            disabled={!canRun((chain) => chain.mergeCells())}
          >
            <Merge className="size-4" />
            Merge cells
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => run((chain) => chain.splitCell())}
            disabled={!canRun((chain) => chain.splitCell())}
          >
            <Split className="size-4" />
            Split cell
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Delete section */}
          <ContextMenuItem
            variant="destructive"
            onSelect={() => run((chain) => chain.deleteRow())}
            disabled={!canRun((chain) => chain.deleteRow())}
          >
            <Trash2 className="size-4" />
            Delete row
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onSelect={() => run((chain) => chain.deleteColumn())}
            disabled={!canRun((chain) => chain.deleteColumn())}
          >
            <Trash2 className="size-4" />
            Delete column
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onSelect={() => run((chain) => chain.deleteTable())}
            disabled={!canRun((chain) => chain.deleteTable())}
          >
            <TableIcon className="size-4" />
            Delete table
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  )
}
