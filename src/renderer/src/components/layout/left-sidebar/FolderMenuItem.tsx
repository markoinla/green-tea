import React, { useEffect, useRef, useState } from 'react'
import { Folder, FilePlus, Pencil, Trash2 } from 'lucide-react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { SidebarMenuButton, SidebarMenuItem, SidebarMenu } from '@renderer/components/ui/sidebar'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { useInlineRename } from '@renderer/hooks/useInlineRename'
import { DocumentMenuItem } from './DocumentMenuItem'
import { DROP_TYPE_FOLDER, isDocumentDragData } from './dnd'
import type { Document } from '../../../../../main/database/types'
import type { Folder as FolderType } from '../../../../../main/database/types'

interface FolderMenuItemProps {
  folder: FolderType
  documents: Document[]
  selectedDocId: string | null
  onSelectDoc: (id: string, opts?: { newTab?: boolean }) => void
  onRenameDoc: (id: string, newTitle: string) => void
  onDeleteDoc: (id: string) => void
  onDuplicateDoc: (id: string) => void
  onRenameFolder: (id: string, newName: string) => void
  onDeleteFolder: (id: string) => void
  onToggleFolder: (id: string, collapsed: number) => void
  onNewDocInFolder: (folderId: string) => void
}

export const FolderMenuItem = React.memo(function FolderMenuItem({
  folder,
  documents,
  selectedDocId,
  onSelectDoc,
  onRenameDoc,
  onDeleteDoc,
  onDuplicateDoc,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onNewDocInFolder
}: FolderMenuItemProps) {
  const dropRef = useRef<HTMLDivElement>(null)
  const [isDraggedOver, setIsDraggedOver] = useState(false)
  const {
    isEditing,
    editValue,
    inputRef,
    startEditing,
    setEditValue,
    handleSubmit,
    handleKeyDown
  } = useInlineRename({
    currentName: folder.name,
    onRename: (newName) => onRenameFolder(folder.id, newName)
  })

  const isCollapsed = folder.collapsed === 1

  // One drop target spans the folder header AND its children, so dropping
  // anywhere within the folder (including onto a child document) resolves to
  // this folder — and dragging over children no longer flickers the indicator.
  // The doc's own folder is excluded via canDrop so it isn't a no-op target.
  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) =>
        isDocumentDragData(source.data) && source.data.folderId !== folder.id,
      getData: () => ({ type: DROP_TYPE_FOLDER, folderId: folder.id }),
      onDragEnter: () => setIsDraggedOver(true),
      onDragLeave: () => setIsDraggedOver(false),
      onDrop: () => setIsDraggedOver(false)
    })
  }, [folder.id])

  return (
    <SidebarMenuItem>
      <div
        ref={dropRef}
        className={`rounded transition-colors ${isDraggedOver ? 'bg-sidebar-accent ring-1 ring-sidebar-ring' : ''}`}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <SidebarMenuButton
              onClick={() => onToggleFolder(folder.id, folder.collapsed)}
              onDoubleClick={startEditing}
              tooltip={folder.name}
              size="sm"
            >
              <Folder className="h-3.5 w-3.5 shrink-0" />
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
                <span className="truncate">{folder.name}</span>
              )}
            </SidebarMenuButton>
          </ContextMenuTrigger>
          <ContextMenuContent
            // Don't let the menu yank focus back to the row on close — it would
            // steal focus (and the text selection) from the rename input.
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <ContextMenuItem onClick={() => onNewDocInFolder(folder.id)}>
              <FilePlus className="h-3.5 w-3.5 mr-2" />
              New Note
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={startEditing}>
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onDeleteFolder(folder.id)}>
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* Folder children */}
        {!isCollapsed &&
          (documents.length > 0 ? (
            <SidebarMenu className="ml-4 border-l border-sidebar-border pl-1">
              {documents.map((doc) => (
                <DocumentMenuItem
                  key={doc.id}
                  id={doc.id}
                  title={doc.title}
                  kind={doc.kind}
                  folderId={folder.id}
                  isSelected={selectedDocId === doc.id}
                  onSelect={(e) => onSelectDoc(doc.id, { newTab: e.metaKey || e.ctrlKey })}
                  onRename={(newTitle) => onRenameDoc(doc.id, newTitle)}
                  onDuplicate={() => onDuplicateDoc(doc.id)}
                  onDelete={() => onDeleteDoc(doc.id)}
                />
              ))}
            </SidebarMenu>
          ) : (
            <div className="ml-4 border-l border-sidebar-border pl-3 py-1 text-xs text-muted-foreground/70 italic">
              Empty
            </div>
          ))}
      </div>
    </SidebarMenuItem>
  )
})
