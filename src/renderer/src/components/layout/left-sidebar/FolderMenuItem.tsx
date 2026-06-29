import React, { useEffect, useRef, useState } from 'react'
import {
  Folder,
  FolderOpen,
  ChevronRight,
  FilePlus,
  FolderPlus,
  Pencil,
  Shapes,
  Table2,
  Trash2
} from 'lucide-react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { SidebarMenuButton, SidebarMenuItem, SidebarMenu } from '@renderer/components/ui/sidebar'
import { Collapsible, CollapsibleContent } from '@renderer/components/ui/collapsible'
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
import type { FolderNode } from './folderTree'

interface FolderMenuItemProps {
  node: FolderNode
  selectedDocId: string | null
  /** Collapse state for synthetic (row-less) intermediate nodes, keyed by path. */
  collapsedPaths: Set<string>
  onTogglePath: (path: string) => void
  onSelectDoc: (id: string, opts?: { newTab?: boolean }) => void
  onRenameDoc: (id: string, newTitle: string) => void
  onDeleteDoc: (id: string) => void
  onDuplicateDoc: (id: string) => void
  onRenameFolder: (id: string, newName: string) => void
  onDeleteFolder: (id: string) => void
  onToggleFolder: (id: string, collapsed: number) => void
  onNewDocInFolder: (folderId: string) => void
  onNewCanvasInFolder: (folderId: string) => void
  onNewTableInFolder: (folderId: string) => void
  onNewSubfolder: (folderId: string) => void
}

export const FolderMenuItem = React.memo(function FolderMenuItem({
  node,
  selectedDocId,
  collapsedPaths,
  onTogglePath,
  onSelectDoc,
  onRenameDoc,
  onDeleteDoc,
  onDuplicateDoc,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onNewDocInFolder,
  onNewCanvasInFolder,
  onNewTableInFolder,
  onNewSubfolder
}: FolderMenuItemProps) {
  const folder = node.folder
  // Synthetic intermediate nodes (no backing row) are grouping-only: collapse
  // works via local state, but rename/delete/new-note/drop need a row id and so
  // are disabled until the folder is materialized (a later move-semantics pass).
  const isReal = folder !== null

  const dropRef = useRef<HTMLDivElement>(null)
  const [isDraggedOver, setIsDraggedOver] = useState(false)

  // Rename edits only the last path segment; the parent prefix is preserved so a
  // nested folder keeps its place (its subdirectory is moved, not flattened).
  const slash = node.path.lastIndexOf('/')
  const parentPath = slash === -1 ? '' : node.path.slice(0, slash)
  const {
    isEditing,
    editValue,
    inputRef,
    startEditing,
    setEditValue,
    handleSubmit,
    handleKeyDown
  } = useInlineRename({
    currentName: node.name,
    onRename: (segment) => {
      if (folder) onRenameFolder(folder.id, parentPath ? `${parentPath}/${segment}` : segment)
    }
  })

  const isCollapsed = isReal ? folder.collapsed === 1 : collapsedPaths.has(node.path)
  const toggle = (): void => {
    if (folder) onToggleFolder(folder.id, folder.collapsed)
    else onTogglePath(node.path)
  }

  // One drop target spans the folder header AND its children, so dropping
  // anywhere within the folder (including onto a child document) resolves to
  // this folder. Only real folders are drop targets — a synthetic intermediate
  // has no row to move a document into.
  useEffect(() => {
    const el = dropRef.current
    if (!el || !folder) return
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) =>
        isDocumentDragData(source.data) && source.data.folderId !== folder.id,
      getData: () => ({ type: DROP_TYPE_FOLDER, folderId: folder.id }),
      onDragEnter: () => setIsDraggedOver(true),
      onDragLeave: () => setIsDraggedOver(false),
      onDrop: () => setIsDraggedOver(false)
    })
  }, [folder])

  const hasChildren = node.children.length > 0 || node.documents.length > 0

  return (
    <SidebarMenuItem>
      <div
        ref={dropRef}
        className={`rounded transition-colors ${isDraggedOver ? 'bg-sidebar-accent ring-1 ring-sidebar-ring' : ''}`}
      >
        <Collapsible open={!isCollapsed}>
          <ContextMenu>
            <ContextMenuTrigger asChild disabled={!isReal}>
              <SidebarMenuButton
                onClick={toggle}
                onDoubleClick={isReal ? startEditing : undefined}
                tooltip={node.name}
                size="sm"
              >
                <ChevronRight
                  className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                />
                {isCollapsed ? (
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                )}
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
                  <span className="truncate">{node.name}</span>
                )}
              </SidebarMenuButton>
            </ContextMenuTrigger>
            {isReal && folder && (
              <ContextMenuContent
                // Don't let the menu yank focus back to the row on close — it would
                // steal focus (and the text selection) from the rename input.
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <ContextMenuItem onClick={() => onNewDocInFolder(folder.id)}>
                  <FilePlus className="h-3.5 w-3.5 mr-2" />
                  New Note
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onNewCanvasInFolder(folder.id)}>
                  <Shapes className="h-3.5 w-3.5 mr-2" />
                  New Canvas
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onNewTableInFolder(folder.id)}>
                  <Table2 className="h-3.5 w-3.5 mr-2" />
                  New Table
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onNewSubfolder(folder.id)}>
                  <FolderPlus className="h-3.5 w-3.5 mr-2" />
                  New Folder
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
            )}
          </ContextMenu>

          {/* Folder children — Radix Collapsible animates the height in/out. */}
          <CollapsibleContent className="gt-collapsible-content">
            {hasChildren ? (
              <SidebarMenu className="ml-4 border-l border-sidebar-border pl-1">
                {node.children.map((child) => (
                  <FolderMenuItem
                    key={child.path}
                    node={child}
                    selectedDocId={selectedDocId}
                    collapsedPaths={collapsedPaths}
                    onTogglePath={onTogglePath}
                    onSelectDoc={onSelectDoc}
                    onRenameDoc={onRenameDoc}
                    onDeleteDoc={onDeleteDoc}
                    onDuplicateDoc={onDuplicateDoc}
                    onRenameFolder={onRenameFolder}
                    onDeleteFolder={onDeleteFolder}
                    onToggleFolder={onToggleFolder}
                    onNewDocInFolder={onNewDocInFolder}
                    onNewCanvasInFolder={onNewCanvasInFolder}
                    onNewTableInFolder={onNewTableInFolder}
                    onNewSubfolder={onNewSubfolder}
                  />
                ))}
                {node.documents.map((doc) => (
                  <DocumentMenuItem
                    key={doc.id}
                    id={doc.id}
                    title={doc.title}
                    kind={doc.kind}
                    folderId={folder ? folder.id : null}
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
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </SidebarMenuItem>
  )
})
