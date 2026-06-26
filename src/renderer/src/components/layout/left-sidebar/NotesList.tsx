import { useEffect, useMemo, useRef, useState } from 'react'
import { FilePlus, FolderPlus } from 'lucide-react'
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
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { FolderMenuItem } from './FolderMenuItem'
import { DocumentMenuItem } from './DocumentMenuItem'
import { DROP_TYPE_ROOT, isDocumentDragData, isFolderDropData, isRootDropData } from './dnd'
import type { Document } from '../../../../../main/database/types'
import type { Folder } from '../../../../../main/database/types'

interface NotesListProps {
  documents: Document[]
  folders: Folder[]
  loading: boolean
  selectedDocId: string | null
  onSelectDoc: (id: string, opts?: { newTab?: boolean }) => void
  onNewDocument: () => void
  onNewFolder: () => void
  onRenameDoc: (id: string, newTitle: string) => void
  onDeleteDoc: (id: string) => void
  onDuplicateDoc: (id: string) => void
  onRenameFolder: (id: string, newName: string) => void
  onDeleteFolder: (id: string) => void
  onToggleFolder: (id: string, collapsed: number) => void
  onNewDocInFolder: (folderId: string) => void
  /** Move a document into a folder (id) or out to the root (null). */
  onMoveDocument: (docId: string, folderId: string | null) => void
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
  onNewFolder,
  onRenameDoc,
  onDeleteDoc,
  onDuplicateDoc,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onNewDocInFolder,
  onMoveDocument
}: NotesListProps) {
  const folderDocs = useMemo(() => {
    const map = new Map<string, Document[]>()
    for (const folder of folders) {
      map.set(folder.id, [])
    }
    for (const doc of documents) {
      if (doc.folder_id && map.has(doc.folder_id)) {
        map.get(doc.folder_id)!.push(doc)
      }
    }
    return map
  }, [folders, documents])

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
                  {folders.map((folder) => (
                    <FolderMenuItem
                      key={folder.id}
                      folder={folder}
                      documents={folderDocs.get(folder.id) || []}
                      selectedDocId={selectedDocId}
                      onSelectDoc={onSelectDoc}
                      onRenameDoc={onRenameDoc}
                      onDeleteDoc={onDeleteDoc}
                      onDuplicateDoc={onDuplicateDoc}
                      onRenameFolder={onRenameFolder}
                      onDeleteFolder={onDeleteFolder}
                      onToggleFolder={onToggleFolder}
                      onNewDocInFolder={onNewDocInFolder}
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
        <ContextMenuItem onClick={onNewFolder}>
          <FolderPlus className="h-3.5 w-3.5 mr-2" />
          New Folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
