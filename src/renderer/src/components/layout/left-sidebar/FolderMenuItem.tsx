import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ClipboardCopy,
  FilePlus,
  FolderInput,
  FolderSymlink,
  FolderPlus,
  Pencil,
  Shapes,
  Table2,
  Trash2
} from 'lucide-react'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
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
import { copyToClipboard } from '@renderer/lib/utils'
import {
  creatablePluginKinds,
  getPluginViewersVersion,
  subscribePluginViewers
} from '@renderer/components/artifacts/registry'
import { DocumentMenuItem } from './DocumentMenuItem'
import { DRAG_TYPE_FOLDER, DROP_TYPE_FOLDER, isDocumentDragData, isFolderDragData } from './dnd'
import type { FolderNode } from './folderTree'
import type { DocumentKind } from '../../../../../main/database/types'

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
  onTransferDocToWorkspace: (id: string, mode: 'copy' | 'move') => void
  onTransferFolderToWorkspace: (id: string, mode: 'copy' | 'move') => void
  onRenameFolder: (id: string, newName: string) => void
  onDeleteFolder: (id: string) => void
  onToggleFolder: (id: string, collapsed: number) => void
  onNewDocInFolder: (folderId: string) => void
  onNewCanvasInFolder: (folderId: string) => void
  onNewTableInFolder: (folderId: string) => void
  /** Create a new plugin-contributed artifact of `kind` inside `folderId`. */
  onNewArtifactKind: (kind: DocumentKind, folderId?: string) => void
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
  onTransferDocToWorkspace,
  onTransferFolderToWorkspace,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onNewDocInFolder,
  onNewCanvasInFolder,
  onNewTableInFolder,
  onNewArtifactKind,
  onNewSubfolder
}: FolderMenuItemProps) {
  // Re-read the plugin-viewer store on change so data-driven "New X" items appear
  // once plugins load asynchronously (memo only gates prop-driven re-renders).
  useSyncExternalStore(subscribePluginViewers, getPluginViewersVersion)
  const pluginKinds = creatablePluginKinds()
  const folder = node.folder
  // Synthetic intermediate nodes (no backing row) are grouping-only: collapse
  // works via local state, but rename/delete/new-note/drop need a row id and so
  // are disabled until the folder is materialized (a later move-semantics pass).
  const isReal = folder !== null

  const dropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLButtonElement>(null)
  const [isDraggedOver, setIsDraggedOver] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

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

  // The folder's `name` is its slash-path relative to the workspace root, which
  // mirrors the on-disk subdirectory — join it onto the workspace's absolute path.
  const copyFolderPath = async (): Promise<void> => {
    if (!folder) return
    const ws = (await window.api.workspaces.get(folder.workspace_id)) as { path?: string } | null
    await copyToClipboard(ws?.path ? `${ws.path}/${node.path}` : node.path, 'Path copied')
  }

  const isCollapsed = isReal ? folder.collapsed === 1 : collapsedPaths.has(node.path)
  const toggle = (): void => {
    if (folder) onToggleFolder(folder.id, folder.collapsed)
    else onTogglePath(node.path)
  }

  // The folder header is a drag source: dragging it nests this folder into
  // another (or out to root). Only real folders move — a synthetic intermediate
  // has no row — and never while its rename input is open.
  useEffect(() => {
    const el = dragRef.current
    if (!el || !folder) return
    return draggable({
      element: el,
      canDrag: () => !isEditing,
      getInitialData: () => ({ type: DRAG_TYPE_FOLDER, folderId: folder.id, path: folder.name }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false)
    })
  }, [folder, isEditing])

  // One drop target spans the folder header AND its children, so dropping
  // anywhere within the folder (including onto a child document) resolves to
  // this folder. Only real folders are drop targets — a synthetic intermediate
  // has no row to move into. Accepts a document (move the doc in) or another
  // folder (nest it in), rejecting no-ops and any move that would put a folder
  // inside itself or its own descendant (a cycle).
  useEffect(() => {
    const el = dropRef.current
    if (!el || !folder) return
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        const data = source.data
        if (isDocumentDragData(data)) return data.folderId !== folder.id
        if (isFolderDragData(data)) {
          if (data.path === folder.name) return false // onto itself
          if (folder.name.startsWith(data.path + '/')) return false // into own descendant
          const slash = data.path.lastIndexOf('/')
          const parentPath = slash === -1 ? '' : data.path.slice(0, slash)
          return parentPath !== folder.name // already a direct child → no-op
        }
        return false
      },
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
                ref={dragRef}
                onClick={toggle}
                onDoubleClick={isReal ? startEditing : undefined}
                tooltip={node.name}
                size="sm"
                className={isDragging ? 'opacity-50' : undefined}
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
                {pluginKinds.map((entry) => (
                  <ContextMenuItem
                    key={entry.kind}
                    onClick={() => onNewArtifactKind(entry.kind, folder.id)}
                  >
                    <entry.icon className="h-3.5 w-3.5 mr-2" />
                    {entry.label}
                  </ContextMenuItem>
                ))}
                <ContextMenuItem onClick={() => onNewSubfolder(folder.id)}>
                  <FolderPlus className="h-3.5 w-3.5 mr-2" />
                  New Folder
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={startEditing}>
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  Rename
                </ContextMenuItem>
                <ContextMenuItem onClick={copyFolderPath}>
                  <ClipboardCopy className="h-3.5 w-3.5 mr-2" />
                  Copy Path
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onTransferFolderToWorkspace(folder.id, 'copy')}>
                  <FolderInput className="h-3.5 w-3.5 mr-2" />
                  Copy to workspace…
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onTransferFolderToWorkspace(folder.id, 'move')}>
                  <FolderSymlink className="h-3.5 w-3.5 mr-2" />
                  Move to workspace…
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
                    onTransferDocToWorkspace={onTransferDocToWorkspace}
                    onTransferFolderToWorkspace={onTransferFolderToWorkspace}
                    onRenameFolder={onRenameFolder}
                    onDeleteFolder={onDeleteFolder}
                    onToggleFolder={onToggleFolder}
                    onNewDocInFolder={onNewDocInFolder}
                    onNewCanvasInFolder={onNewCanvasInFolder}
                    onNewTableInFolder={onNewTableInFolder}
                    onNewArtifactKind={onNewArtifactKind}
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
                    filePath={doc.file_path}
                    isSelected={selectedDocId === doc.id}
                    onSelect={(e) => onSelectDoc(doc.id, { newTab: e.metaKey || e.ctrlKey })}
                    onRename={(newTitle) => onRenameDoc(doc.id, newTitle)}
                    onDuplicate={() => onDuplicateDoc(doc.id)}
                    onTransferToWorkspace={(mode) => onTransferDocToWorkspace(doc.id, mode)}
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
