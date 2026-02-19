import { useMemo } from 'react'
import { FilePlus, FolderPlus } from 'lucide-react'
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
import type { Document } from '../../../../../main/database/types'
import type { Folder } from '../../../../../main/database/types'

interface NotesListProps {
  documents: Document[]
  folders: Folder[]
  loading: boolean
  selectedDocId: string | null
  dragOverFolderId: string | null
  dragOverRoot: boolean
  onSelectDoc: (id: string) => void
  onNewDocument: () => void
  onNewFolder: () => void
  onRenameDoc: (id: string, newTitle: string) => void
  onDeleteDoc: (id: string) => void
  onDuplicateDoc: (id: string) => void
  onRenameFolder: (id: string, newName: string) => void
  onDeleteFolder: (id: string) => void
  onToggleFolder: (id: string, collapsed: number) => void
  onNewDocInFolder: (folderId: string) => void
  onDragStart: (e: React.DragEvent, docId: string) => void
  onDropOnFolder: (e: React.DragEvent, folderId: string) => void
  onDragOverFolder: (e: React.DragEvent, folderId: string) => void
  onDragLeaveFolder: () => void
  onDragOverRoot: (e: React.DragEvent) => void
  onDragLeaveRoot: () => void
  onDropOnRoot: (e: React.DragEvent) => void
}

export function NotesList({
  documents,
  folders,
  loading,
  selectedDocId,
  dragOverFolderId,
  dragOverRoot,
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
  onDragStart,
  onDropOnFolder,
  onDragOverFolder,
  onDragLeaveFolder,
  onDragOverRoot,
  onDragLeaveRoot,
  onDropOnRoot
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

  const rootDocs = useMemo(() => documents.filter((doc) => !doc.folder_id), [documents])

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
                      isDragOver={dragOverFolderId === folder.id}
                      onSelectDoc={onSelectDoc}
                      onRenameDoc={onRenameDoc}
                      onDeleteDoc={onDeleteDoc}
                      onDuplicateDoc={onDuplicateDoc}
                      onRenameFolder={onRenameFolder}
                      onDeleteFolder={onDeleteFolder}
                      onToggleFolder={onToggleFolder}
                      onDragStart={onDragStart}
                      onDrop={onDropOnFolder}
                      onDragOver={onDragOverFolder}
                      onDragLeave={onDragLeaveFolder}
                      onNewDocInFolder={onNewDocInFolder}
                    />
                  ))}

                  <div
                    onDragOver={onDragOverRoot}
                    onDragLeave={onDragLeaveRoot}
                    onDrop={onDropOnRoot}
                    className={`min-h-[24px] transition-colors rounded ${dragOverRoot ? 'bg-sidebar-accent' : ''}`}
                  >
                    {rootDocs.map((doc) => (
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
                  </div>
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
