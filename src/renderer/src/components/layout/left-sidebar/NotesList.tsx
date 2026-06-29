import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { FilePlus, FolderPlus, RefreshCw, Shapes, Table2 } from 'lucide-react'
import {
  dropTargetForElements,
  monitorForElements
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu
} from '@renderer/components/ui/sidebar'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { FolderMenuItem } from './FolderMenuItem'
import { DocumentMenuItem } from './DocumentMenuItem'
import { buildFolderTree } from './folderTree'
import { DROP_TYPE_ROOT, isDocumentDragData, isFolderDropData, isRootDropData } from './dnd'
import {
  creatablePluginKinds,
  getPluginViewersVersion,
  subscribePluginViewers
} from '@renderer/components/artifacts/registry'
import type { Document, DocumentKind } from '../../../../../main/database/types'
import type { Folder } from '../../../../../main/database/types'

interface NotesListProps {
  documents: Document[]
  folders: Folder[]
  loading: boolean
  selectedDocId: string | null
  onSelectDoc: (id: string, opts?: { newTab?: boolean }) => void
  onNewDocument: () => void
  /** Create a new canvas artifact at the root. */
  onNewCanvas: () => void
  /** Create a new table (csv) artifact at the root. */
  onNewTable: () => void
  /** Create a new plugin-contributed artifact of `kind`, optionally inside `folderId`. */
  onNewArtifactKind: (kind: DocumentKind, folderId?: string) => void
  onNewFolder: () => void
  onRenameDoc: (id: string, newTitle: string) => void
  onDeleteDoc: (id: string) => void
  onDuplicateDoc: (id: string) => void
  onRenameFolder: (id: string, newName: string) => void
  onDeleteFolder: (id: string) => void
  onToggleFolder: (id: string, collapsed: number) => void
  onNewDocInFolder: (folderId: string) => void
  /** Create a new canvas artifact inside the given folder. */
  onNewCanvasInFolder: (folderId: string) => void
  /** Create a new table (csv) artifact inside the given folder. */
  onNewTableInFolder: (folderId: string) => void
  /** Create a subfolder under the given folder. */
  onNewSubfolder: (folderId: string) => void
  /** Move a document into a folder (id) or out to the root (null). */
  onMoveDocument: (docId: string, folderId: string | null) => void
  /** Rebuild the index from disk (manual reconcile of external changes). */
  onRefresh: () => void
}

/**
 * The root drop zone (move a document out to top level) plus auto-scroll for the
 * sidebar's scroll container. Lives in its own component so the drop-target
 * binding is attached/torn down with the element's mount lifecycle.
 */
function RootDropZone({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDraggedOver, setIsDraggedOver] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const scrollEl = el.closest('[data-sidebar="content"]') as HTMLElement | null
    return combine(
      dropTargetForElements({
        element: el,
        // Only documents that aren't already at root.
        canDrop: ({ source }) => isDocumentDragData(source.data) && source.data.folderId !== null,
        getData: () => ({ type: DROP_TYPE_ROOT }),
        onDragEnter: () => setIsDraggedOver(true),
        onDragLeave: () => setIsDraggedOver(false),
        onDrop: () => setIsDraggedOver(false)
      }),
      scrollEl ? autoScrollForElements({ element: scrollEl }) : () => {}
    )
  }, [])

  return (
    <div
      ref={ref}
      className={`min-h-[32px] transition-colors rounded ${isDraggedOver ? 'bg-sidebar-accent' : ''}`}
    >
      {children}
    </div>
  )
}

export function NotesList({
  documents,
  folders,
  loading,
  selectedDocId,
  onSelectDoc,
  onNewDocument,
  onNewCanvas,
  onNewTable,
  onNewArtifactKind,
  onNewFolder,
  onRenameDoc,
  onDeleteDoc,
  onDuplicateDoc,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onNewDocInFolder,
  onNewCanvasInFolder,
  onNewTableInFolder,
  onNewSubfolder,
  onMoveDocument,
  onRefresh
}: NotesListProps) {
  // Re-read the plugin-viewer store on change so the data-driven "New X" items
  // appear once plugins load (their contributions arrive asynchronously).
  useSyncExternalStore(subscribePluginViewers, getPluginViewersVersion)
  const pluginKinds = creatablePluginKinds()
  // The folder rows are flat but their names are slash-paths; build the nested
  // tree the sidebar renders from them (synthesizing row-less intermediates).
  const folderTree = useMemo(() => buildFolderTree(folders, documents), [folders, documents])

  // Collapse state for synthetic intermediate nodes (which have no row to persist
  // it on). Kept in memory only — resets on reload, which is fine for grouping.
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set())
  const onTogglePath = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // Root docs are those with no folder, PLUS any whose folder_id points to a
  // folder that isn't in the current list. The latter guards a transient
  // docs/folders refetch race (and any dangling folder_id) from making a
  // document silently vanish — it falls back to root instead.
  const rootDocs = useMemo(() => {
    const folderIds = new Set(folders.map((f) => f.id))
    return documents.filter((doc) => !doc.folder_id || !folderIds.has(doc.folder_id))
  }, [documents, folders])

  // A single global monitor performs the move on drop, reading the innermost
  // drop target. Centralizing it (rather than per-target onDrop) avoids
  // double-handling and keeps the move + no-op guard in one place.
  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => isDocumentDragData(source.data),
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets[0]
        if (!target) return
        const src = source.data
        if (!isDocumentDragData(src)) return
        let destFolderId: string | null
        if (isFolderDropData(target.data)) destFolderId = target.data.folderId
        else if (isRootDropData(target.data)) destFolderId = null
        else return
        if (src.folderId === destFolderId) return // no-op
        onMoveDocument(src.docId, destFolderId)
      }
    })
  }, [onMoveDocument])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <SidebarContent>
          <SidebarGroup className="px-1">
            <SidebarGroupContent>
              {loading ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>
              ) : documents.length === 0 && folders.length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center group-data-[collapsible=icon]:hidden">
                  No documents yet.
                </div>
              ) : (
                <SidebarMenu>
                  {folderTree.map((node) => (
                    <FolderMenuItem
                      key={node.path}
                      node={node}
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
                      onNewArtifactKind={onNewArtifactKind}
                      onNewSubfolder={onNewSubfolder}
                    />
                  ))}

                  <RootDropZone>
                    {rootDocs.map((doc) => (
                      <DocumentMenuItem
                        key={doc.id}
                        id={doc.id}
                        title={doc.title}
                        kind={doc.kind}
                        folderId={null}
                        isSelected={selectedDocId === doc.id}
                        onSelect={(e) => onSelectDoc(doc.id, { newTab: e.metaKey || e.ctrlKey })}
                        onRename={(newTitle) => onRenameDoc(doc.id, newTitle)}
                        onDuplicate={() => onDuplicateDoc(doc.id)}
                        onDelete={() => onDeleteDoc(doc.id)}
                      />
                    ))}
                  </RootDropZone>
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onNewDocument}>
          <FilePlus className="h-3.5 w-3.5 mr-2" />
          New Note
        </ContextMenuItem>
        <ContextMenuItem onClick={onNewCanvas}>
          <Shapes className="h-3.5 w-3.5 mr-2" />
          New Canvas
        </ContextMenuItem>
        <ContextMenuItem onClick={onNewTable}>
          <Table2 className="h-3.5 w-3.5 mr-2" />
          New Table
        </ContextMenuItem>
        {pluginKinds.map((entry) => (
          <ContextMenuItem key={entry.kind} onClick={() => onNewArtifactKind(entry.kind)}>
            <entry.icon className="h-3.5 w-3.5 mr-2" />
            {entry.label}
          </ContextMenuItem>
        ))}
        <ContextMenuItem onClick={onNewFolder}>
          <FolderPlus className="h-3.5 w-3.5 mr-2" />
          New Folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          Refresh
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
