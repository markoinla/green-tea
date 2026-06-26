import React, { useEffect, useRef, useState } from 'react'
import { Pencil, Copy, Trash2 } from 'lucide-react'
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { iconForKind } from '@renderer/components/artifacts/registry'
import type { DocumentKind } from '../../../../../main/database/types'
import { SidebarMenuButton, SidebarMenuItem } from '@renderer/components/ui/sidebar'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { useInlineRename } from '@renderer/hooks/useInlineRename'
import { DRAG_TYPE_DOCUMENT } from './dnd'

interface DocumentMenuItemProps {
  id: string
  title: string
  /** Drives the icon (note → FileText; html → FileCode; …). */
  kind?: DocumentKind
  /** The folder this doc currently lives in (null = root); used to skip no-op drops. */
  folderId: string | null
  isSelected: boolean
  onSelect: (e: React.MouseEvent) => void
  onRename: (newTitle: string) => void
  onDuplicate: () => void
  onDelete: () => void
}

export const DocumentMenuItem = React.memo(function DocumentMenuItem({
  id,
  title,
  kind,
  folderId,
  isSelected,
  onSelect,
  onRename,
  onDuplicate,
  onDelete
}: DocumentMenuItemProps) {
  const Icon = iconForKind(kind)
  const ref = useRef<HTMLLIElement>(null)
  const [dragging, setDragging] = useState(false)
  const {
    isEditing,
    editValue,
    inputRef,
    startEditing,
    setEditValue,
    handleSubmit,
    handleKeyDown
  } = useInlineRename({ currentName: title, onRename })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return draggable({
      element: el,
      // Don't start a drag from the rename input.
      canDrag: () => !isEditing,
      getInitialData: () => ({ type: DRAG_TYPE_DOCUMENT, docId: id, folderId }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false)
    })
  }, [id, folderId, isEditing])

  return (
    <SidebarMenuItem ref={ref}>
      <TooltipProvider delayDuration={1000}>
        <Tooltip>
          <ContextMenu>
            <TooltipTrigger asChild>
              <ContextMenuTrigger asChild>
                <SidebarMenuButton
                  isActive={isSelected}
                  onClick={onSelect}
                  onDoubleClick={startEditing}
                  tooltip={title}
                  size="sm"
                  className={dragging ? 'opacity-50' : undefined}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleSubmit}
                      onKeyDown={handleKeyDown}
                      className="flex-1 bg-sidebar-accent text-sidebar-foreground text-xs px-1.5 py-0 rounded border border-sidebar-border outline-none min-w-0"
                      onClick={(e) => e.stopPropagation()}
                      onContextMenu={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="truncate">{title}</span>
                  )}
                </SidebarMenuButton>
              </ContextMenuTrigger>
            </TooltipTrigger>
            <ContextMenuContent
              // Don't let the menu yank focus back to the row on close — it would
              // steal focus (and the text selection) from the rename input.
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <ContextMenuItem onClick={startEditing}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Rename
              </ContextMenuItem>
              <ContextMenuItem onClick={onDuplicate}>
                <Copy className="h-3.5 w-3.5 mr-2" />
                Duplicate
              </ContextMenuItem>
              <ContextMenuItem onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          {!isEditing && <TooltipContent side="right">{title}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
    </SidebarMenuItem>
  )
})
