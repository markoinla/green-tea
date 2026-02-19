import React from 'react'
import { FileText, Pencil, Copy, Trash2 } from 'lucide-react'
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

interface DocumentMenuItemProps {
  id: string
  title: string
  isSelected: boolean
  onSelect: () => void
  onRename: (newTitle: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onDragStart: (e: React.DragEvent) => void
}

export const DocumentMenuItem = React.memo(function DocumentMenuItem({
  id: _id, // eslint-disable-line @typescript-eslint/no-unused-vars
  title,
  isSelected,
  onSelect,
  onRename,
  onDuplicate,
  onDelete,
  onDragStart
}: DocumentMenuItemProps) {
  const {
    isEditing,
    editValue,
    inputRef,
    startEditing,
    setEditValue,
    handleSubmit,
    handleKeyDown
  } = useInlineRename({ currentName: title, onRename })

  return (
    <SidebarMenuItem>
      <TooltipProvider delayDuration={1000}>
        <Tooltip>
          <ContextMenu>
            <TooltipTrigger asChild>
              <ContextMenuTrigger asChild>
                <SidebarMenuButton
                  draggable
                  onDragStart={onDragStart}
                  isActive={isSelected}
                  onClick={onSelect}
                  onDoubleClick={startEditing}
                  tooltip={title}
                  size="sm"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
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
                    />
                  ) : (
                    <span className="truncate">{title}</span>
                  )}
                </SidebarMenuButton>
              </ContextMenuTrigger>
            </TooltipTrigger>
            <ContextMenuContent>
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
