import { useMemo, useRef, useState } from 'react'
import { X, History, FileCode, Copy, FileDown, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useDocuments } from '@renderer/hooks/useDocuments'
import { useWorkspaceFiles } from '@renderer/hooks/useWorkspaceFiles'
import { useInlineRename } from '@renderer/hooks/useInlineRename'
import { isFileTabId, parseFileTabId } from '@renderer/lib/tab-ids'
import { viewerForKind } from '@renderer/components/artifacts/registry'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'

interface TabStripProps {
  workspaceId: string | null
  openDocIds: string[]
  activeDocId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseToRight: (id: string) => void
  onCloseAll: () => void
  onReorder: (from: number, to: number) => void
}

export function TabStrip({
  workspaceId,
  openDocIds,
  activeDocId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onReorder
}: TabStripProps) {
  const { documents, updateDocument } = useDocuments(workspaceId)
  const { files } = useWorkspaceFiles(workspaceId)
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const titles = useMemo(() => {
    const map = new Map<string, string>()
    for (const doc of documents) map.set(doc.id, doc.title)
    return map
  }, [documents])

  // Per-kind tab icon for artifact docs (notes stay iconless, matching today).
  const iconById = useMemo(() => {
    const map = new Map<string, LucideIcon>()
    for (const doc of documents) {
      const entry = viewerForKind(doc.kind)
      if (entry) map.set(doc.id, entry.icon)
    }
    return map
  }, [documents])

  // `file:` (HTML artifact) tabs label from the workspace-file name, not a doc
  // title.
  const fileNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of files) map.set(f.id, f.file_name)
    return map
  }, [files])

  const labelFor = (id: string): string => {
    const fileId = isFileTabId(id) ? parseFileTabId(id) : null
    if (fileId) return fileNames.get(fileId) ?? 'HTML'
    return titles.get(id) ?? 'Untitled'
  }

  return (
    <div
      className="flex items-center min-w-0 flex-1 h-full overflow-x-auto overflow-y-hidden scrollbar-none"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {openDocIds.map((id, index) => (
        <Tab
          key={id}
          title={labelFor(id)}
          isFile={isFileTabId(id)}
          icon={isFileTabId(id) ? FileCode : iconById.get(id)}
          isActive={id === activeDocId}
          isDragOver={dragOverIndex === index}
          onActivate={() => onActivate(id)}
          onClose={() => onClose(id)}
          onRename={(newTitle) => updateDocument(id, { title: newTitle })}
          onCloseOthers={() => onCloseOthers(id)}
          onCloseToRight={() => onCloseToRight(id)}
          onCloseAll={onCloseAll}
          onDragStart={() => {
            dragIndexRef.current = index
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOverIndex(index)
          }}
          onDragLeave={() => setDragOverIndex((cur) => (cur === index ? null : cur))}
          onDrop={() => {
            const from = dragIndexRef.current
            dragIndexRef.current = null
            setDragOverIndex(null)
            if (from !== null && from !== index) onReorder(from, index)
          }}
        />
      ))}
    </div>
  )
}

// Version-history button — rendered by AppLayout at the right end of the strip.
export function VersionHistoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground rounded-sm p-1 transition-colors hover:bg-muted shrink-0"
      title="Version history"
    >
      <History className="h-4 w-4" />
    </button>
  )
}

// Copy-as-markdown button — sits beside the version-history button.
export function CopyMarkdownButton({
  onClick,
  disabled
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-muted-foreground hover:text-foreground rounded-sm p-1 transition-colors hover:bg-muted shrink-0 disabled:opacity-40 disabled:pointer-events-none"
      title="Copy as Markdown"
    >
      <Copy className="h-4 w-4" />
    </button>
  )
}

// Export-to-PDF button — sits beside the version-history button.
export function ExportPdfButton({
  onClick,
  disabled
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-muted-foreground hover:text-foreground rounded-sm p-1 transition-colors hover:bg-muted shrink-0 disabled:opacity-40 disabled:pointer-events-none"
      title="Export to PDF"
    >
      <FileDown className="h-4 w-4" />
    </button>
  )
}

interface TabProps {
  title: string
  isFile?: boolean
  /** Optional leading icon (file/artifact tabs); notes pass none. */
  icon?: LucideIcon
  isActive: boolean
  isDragOver: boolean
  onActivate: () => void
  onClose: () => void
  onRename: (newTitle: string) => void
  onCloseOthers: () => void
  onCloseToRight: () => void
  onCloseAll: () => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: () => void
}

function Tab({
  title,
  isFile = false,
  icon: Icon,
  isActive,
  isDragOver,
  onActivate,
  onClose,
  onRename,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop
}: TabProps) {
  const {
    isEditing,
    editValue,
    inputRef,
    startEditing,
    setEditValue,
    handleSubmit,
    handleKeyDown
  } = useInlineRename({ currentName: title, onRename })

  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle-click closes — but not while renaming (matches the onClick guard).
    if (e.button === 1 && !isEditing) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable={!isEditing}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onMouseDown={handleMouseDown}
          onClick={() => !isEditing && onActivate()}
          onDoubleClick={isFile ? undefined : startEditing}
          className={cn(
            'group/tab relative flex items-center gap-1.5 h-full px-3 min-w-[100px] max-w-[200px] border-r dark:border-white/5 border-black/5 cursor-default select-none transition-colors',
            isActive
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            isDragOver && 'bg-accent'
          )}
        >
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSubmit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-transparent text-sm outline-none"
            />
          ) : (
            <>
              {Icon && <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />}
              <span className="flex-1 min-w-0 truncate text-sm">{title}</span>
            </>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            className={cn(
              'shrink-0 rounded-sm p-0.5 hover:bg-muted transition-opacity',
              isActive ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'
            )}
            tabIndex={-1}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onClose}>Close</ContextMenuItem>
        <ContextMenuItem onClick={onCloseOthers}>Close Others</ContextMenuItem>
        <ContextMenuItem onClick={onCloseToRight}>Close to the Right</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCloseAll}>Close All</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
