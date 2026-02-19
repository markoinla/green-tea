import React from 'react'
import { Folder, FilePlus, Pencil, Trash2 } from 'lucide-react'
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
import type { Document } from '../../../../../main/database/types'
import type { Folder as FolderType } from '../../../../../main/database/types'

interface FolderMenuItemProps {
  folder: FolderType
  documents: Document[]
  selectedDocId: string | null
  isDragOver: boolean
  onSelectDoc: (id: string) => void
  onRenameDoc: (id: string, newTitle: string) => void
  onDeleteDoc: (id: string) => void
  onDuplicateDoc: (id: string) => void
  onRenameFolder: (id: string, newName: string) => void
  onDeleteFolder: (id: string) => void
  onToggleFolder: (id: string, collapsed: number) => void
  onDragStart: (e: React.DragEvent, docId: string) => void
  onDrop: (e: React.DragEvent, folderId: string) => void
  onDragOver: (e: React.DragEvent, folderId: string) => void
  onDragLeave: () => void
  onNewDocInFolder: (folderId: string) => void
}

export const FolderMenuItem = React.memo(function FolderMenuItem({
  folder,
  documents,
  selectedDocId,
  isDragOver,
  onSelectDoc,
  onRenameDoc,
  onDeleteDoc,
  onDuplicateDoc,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onDragStart,
  onDrop,
  onDragOver,
  onDragLeave,
  onNewDocInFolder
}: FolderMenuItemProps) {
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

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onDragOver={(e) => onDragOver(e, folder.id)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, folder.id)}
            className={`rounded transition-colors ${isDragOver ? 'bg-sidebar-accent ring-1 ring-sidebar-ring' : ''}`}
          >
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
                />
              ) : (
                <span className="truncate">{folder.name}</span>
              )}
            </SidebarMenuButton>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
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
      {!isCollapsed && documents.length > 0 && (
        <SidebarMenu className="ml-4 border-l border-sidebar-border pl-1">
          {documents.map((doc) => (
            <DocumentMenuItem
              key={doc.id}
              id={doc.id}
              title={doc.title}
              isSelected={selectedDocId === doc.id}
              onSelect={() => onSelectDoc(doc.id)}
              onRename={(newTitle) => onRenameDoc(doc.id, newTitle)}
              onDuplicate={() => onDuplicateDoc(doc.id)}
              onDelete={() => onDeleteDoc(doc.id)}
              onDragStart={(e) => onDragStart(e, doc.id)}
            />
          ))}
        </SidebarMenu>
      )}
    </SidebarMenuItem>
  )
})
