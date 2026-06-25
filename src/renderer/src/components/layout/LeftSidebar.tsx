import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { Sidebar, SidebarHeader } from '@renderer/components/ui/sidebar'
import { useMetadataFilter } from '@renderer/contexts/MetadataFilterContext'
import { useDocuments } from '@renderer/hooks/useDocuments'
import type { Document } from '../../../../main/database/types'
import { useFolders } from '@renderer/hooks/useFolders'
import { useWorkspaceFiles } from '@renderer/hooks/useWorkspaceFiles'
import { useSidebarDragAndDrop } from '@renderer/hooks/useSidebarDragAndDrop'
import { WorkspaceSwitcher } from '@renderer/components/workspace/WorkspaceSwitcher'
import { CommandMenu } from '@renderer/components/command/CommandMenu'
import { NotesList } from './left-sidebar/NotesList'
import { WorkspaceFilesSection } from './left-sidebar/WorkspaceFilesSection'
import { SidebarFooterSection } from './left-sidebar/SidebarFooterSection'

interface LeftSidebarProps {
  selectedDocId: string | null
  onSelectDoc: (id: string, opts?: { newTab?: boolean }) => void
  /** Open a workspace HTML artifact in a Green Tea tab. */
  onOpenFile: (fileId: string) => void
  selectedWorkspaceId: string | null
  onSelectWorkspace: (id: string) => void
  width?: number
  resizing?: boolean
  hoverExpanded?: boolean
  onHoverChange?: (hovered: boolean) => void
}

export function LeftSidebar({
  selectedDocId,
  onSelectDoc,
  onOpenFile,
  selectedWorkspaceId,
  onSelectWorkspace,
  width,
  resizing,
  hoverExpanded,
  onHoverChange
}: LeftSidebarProps) {
  const { documents, loading, createDocument, updateDocument, deleteDocument } =
    useDocuments(selectedWorkspaceId)
  const { folders, createFolder, updateFolder, deleteFolder } = useFolders(selectedWorkspaceId)
  const {
    files: workspaceFiles,
    addFiles,
    pickAndAddFiles,
    pickAndAddFolder,
    removeFile
  } = useWorkspaceFiles(selectedWorkspaceId)
  const [commandOpen, setCommandOpen] = useState(false)

  // Active metadata filter (Phase 4). When set, the note list is restricted to
  // the matching documents via db:metadata:listByProperty; clearing restores the
  // full list. The filter is dropped automatically on a workspace switch.
  const { filter, clearFilter } = useMetadataFilter()
  const filterActive = filter !== null && filter.workspaceId === selectedWorkspaceId
  const [filteredIds, setFilteredIds] = useState<Set<string> | null>(null)

  useEffect(() => {
    if (!filterActive || !filter) {
      setFilteredIds(null)
      return
    }
    let cancelled = false
    window.api.metadata
      .listByProperty(filter.workspaceId, filter.key, filter.value)
      .then((docs) => {
        if (!cancelled) setFilteredIds(new Set((docs as Document[]).map((d) => d.id)))
      })
    return () => {
      cancelled = true
    }
  }, [filterActive, filter, documents])

  // Drop a stale filter when the workspace switches (its key/value belong to the
  // workspace it was set in).
  useEffect(() => {
    if (filter && filter.workspaceId !== selectedWorkspaceId) clearFilter()
  }, [filter, selectedWorkspaceId, clearFilter])

  const visibleDocuments = useMemo(
    () =>
      filterActive && filteredIds ? documents.filter((d) => filteredIds.has(d.id)) : documents,
    [filterActive, filteredIds, documents]
  )

  const {
    dragOverFolderId,
    dragOverRoot,
    handleDragStart,
    handleDropOnFolder,
    handleDropOnRoot,
    handleDragOverFolder,
    handleDragOverRoot,
    handleDragLeaveFolder,
    handleDragLeaveRoot
  } = useSidebarDragAndDrop({ updateDocument })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleNewDocument = useCallback(async () => {
    if (!selectedWorkspaceId) return
    const doc = await createDocument({ title: 'Untitled' })
    onSelectDoc(doc.id, { newTab: true })
  }, [selectedWorkspaceId, createDocument, onSelectDoc])

  const handleNewFolder = useCallback(async () => {
    await createFolder({ name: 'Untitled Folder' })
  }, [createFolder])

  const handleNewDocInFolder = useCallback(
    async (folderId: string) => {
      if (!selectedWorkspaceId) return
      const doc = await createDocument({ title: 'Untitled', folder_id: folderId })
      onSelectDoc(doc.id, { newTab: true })
    },
    [selectedWorkspaceId, createDocument, onSelectDoc]
  )

  const handleDeleteDoc = useCallback(
    async (id: string) => {
      // The open tab (if any) closes via the reconcileDeletions path in App once
      // `documents:changed` fires — no need to clear selection here.
      await deleteDocument(id)
    },
    [deleteDocument]
  )

  const handleRenameDoc = useCallback(
    async (id: string, newTitle: string) => {
      await updateDocument(id, { title: newTitle })
    },
    [updateDocument]
  )

  const handleDuplicateDoc = useCallback(
    async (id: string) => {
      if (!selectedWorkspaceId) return
      const original = (await window.api.documents.get(id)) as {
        title: string
        content: string | null
        folder_id: string | null
      }
      const doc = await createDocument({
        title: `${original.title} (copy)`,
        folder_id: original.folder_id
      })
      if (original.content) {
        await updateDocument(doc.id, { content: original.content })
      }
      onSelectDoc(doc.id, { newTab: true })
    },
    [selectedWorkspaceId, createDocument, updateDocument, onSelectDoc]
  )

  const handleDeleteFolder = useCallback(
    async (id: string) => {
      await deleteFolder(id)
    },
    [deleteFolder]
  )

  const handleRenameFolder = useCallback(
    async (id: string, newName: string) => {
      await updateFolder(id, { name: newName })
    },
    [updateFolder]
  )

  const handleToggleFolder = useCallback(
    async (id: string, collapsed: number) => {
      await updateFolder(id, { collapsed: collapsed ? 0 : 1 })
    },
    [updateFolder]
  )

  return (
    <Sidebar
      side="left"
      collapsible="icon"
      className="border-r border-border"
      width={width}
      resizing={resizing}
      hoverExpanded={hoverExpanded}
      onHoverChange={onHoverChange}
    >
      <SidebarHeader className="px-3 py-2">
        <WorkspaceSwitcher
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
          onNewDocument={handleNewDocument}
          onNewFolder={handleNewFolder}
        />
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="relative w-full h-8 rounded-md bg-sidebar-accent/50 pl-8 pr-3 text-xs text-muted-foreground text-left hover:bg-sidebar-accent hover:text-foreground transition-all group-data-[collapsible=icon]:hidden ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" />
          <span>Search</span>
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            <span className="text-xs">&#8984;</span>K
          </kbd>
        </button>
        <CommandMenu
          open={commandOpen}
          onOpenChange={setCommandOpen}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectDoc={onSelectDoc}
          onSelectWorkspace={onSelectWorkspace}
        />
        {filterActive && filter && (
          <div className="flex items-center gap-1.5 rounded-md bg-sidebar-accent/60 px-2 py-1 text-xs group-data-[collapsible=icon]:hidden">
            <span className="text-muted-foreground shrink-0">Filter:</span>
            <span className="truncate font-medium" title={`${filter.key}: ${filter.value}`}>
              {filter.key}: {filter.value}
            </span>
            <button
              type="button"
              aria-label="Clear filter"
              className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
              onClick={clearFilter}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </SidebarHeader>

      <NotesList
        documents={visibleDocuments}
        folders={folders}
        loading={loading}
        selectedDocId={selectedDocId}
        dragOverFolderId={dragOverFolderId}
        dragOverRoot={dragOverRoot}
        onSelectDoc={onSelectDoc}
        onNewDocument={handleNewDocument}
        onNewFolder={handleNewFolder}
        onRenameDoc={handleRenameDoc}
        onDeleteDoc={handleDeleteDoc}
        onDuplicateDoc={handleDuplicateDoc}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onToggleFolder={handleToggleFolder}
        onNewDocInFolder={handleNewDocInFolder}
        onDragStart={handleDragStart}
        onDropOnFolder={handleDropOnFolder}
        onDragOverFolder={handleDragOverFolder}
        onDragLeaveFolder={handleDragLeaveFolder}
        onDragOverRoot={handleDragOverRoot}
        onDragLeaveRoot={handleDragLeaveRoot}
        onDropOnRoot={handleDropOnRoot}
      />

      <WorkspaceFilesSection
        files={workspaceFiles}
        addFiles={addFiles}
        pickAndAddFiles={pickAndAddFiles}
        pickAndAddFolder={pickAndAddFolder}
        removeFile={removeFile}
        onOpenInApp={(file) => onOpenFile(file.id)}
      />

      <SidebarFooterSection selectedWorkspaceId={selectedWorkspaceId} />
    </Sidebar>
  )
}
