import React, { useState } from 'react'
import { useDocumentVersions } from '@renderer/hooks/useDocumentVersions'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@renderer/components/ui/sheet'
import { History, Save, RotateCcw, Trash2, Bot, PenLine, Clock, ArchiveRestore } from 'lucide-react'
import type { DocumentVersion } from '../../../main/database/types'

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr + 'Z')
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function sourceIcon(source: string): React.ReactNode {
  switch (source) {
    case 'agent_patch':
      return <Bot className="h-3 w-3" />
    case 'manual':
      return <PenLine className="h-3 w-3" />
    case 'restore':
      return <ArchiveRestore className="h-3 w-3" />
    default:
      return <Clock className="h-3 w-3" />
  }
}

export function sourceLabel(source: string): string {
  switch (source) {
    case 'agent_patch':
      return 'Agent'
    case 'manual':
      return 'Manual'
    case 'restore':
      return 'Restore'
    default:
      return 'Auto'
  }
}

function sourceColor(source: string): string {
  switch (source) {
    case 'agent_patch':
      return 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
    case 'manual':
      return 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
    case 'restore':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

interface VersionHistoryPanelProps {
  documentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onPreviewVersion?: (version: DocumentVersion | null) => void
  activePreviewId?: string | null
}

export function VersionHistoryPanel({
  documentId,
  open,
  onOpenChange,
  onPreviewVersion,
  activePreviewId
}: VersionHistoryPanelProps): React.ReactNode {
  const { versions, loading, createManualVersion, restoreVersion, deleteVersion } =
    useDocumentVersions(documentId)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const handleRestore = async (id: string): Promise<void> => {
    setRestoringId(id)
    await restoreVersion(id)
    setRestoringId(null)
    onPreviewVersion?.(null)
  }

  const handleSaveSnapshot = async (): Promise<void> => {
    await createManualVersion()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="w-[340px] sm:max-w-[340px] p-0 flex flex-col"
        showOverlay={false}
        showCloseButton={false}
      >
        <SheetHeader className="px-4 pt-4 pb-2 border-b dark:border-white/5 border-black/5">
          <SheetTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" />
            Version History
          </SheetTitle>
          <SheetDescription className="text-xs">
            Browse and restore previous versions
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 py-2 border-b dark:border-white/5 border-black/5">
          <button
            onClick={handleSaveSnapshot}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full px-2 py-1.5 rounded hover:bg-muted"
          >
            <Save className="h-3.5 w-3.5" />
            Save snapshot
          </button>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 py-2">
            {loading && versions.length === 0 && (
              <p className="text-xs text-muted-foreground py-8 text-center">Loading...</p>
            )}
            {!loading && versions.length === 0 && (
              <p className="text-xs text-muted-foreground py-8 text-center">
                No versions yet. Versions are created automatically as you edit.
              </p>
            )}
            <div className="space-y-0.5">
              {versions.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  isSelected={activePreviewId === v.id}
                  isRestoring={restoringId === v.id}
                  onSelect={() => onPreviewVersion?.(v)}
                  onRestore={() => handleRestore(v.id)}
                  onDelete={() => deleteVersion(v.id)}
                />
              ))}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function VersionRow({
  version,
  isSelected,
  isRestoring,
  onSelect,
  onRestore,
  onDelete
}: {
  version: DocumentVersion
  isSelected: boolean
  isRestoring: boolean
  onSelect: () => void
  onRestore: () => void
  onDelete: () => void
}): React.ReactNode {
  const [showActions, setShowActions] = useState(false)

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
        isSelected ? 'bg-muted' : 'hover:bg-muted/50'
      }`}
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${sourceColor(version.source)}`}
          >
            {sourceIcon(version.source)}
            {sourceLabel(version.source)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatRelativeTime(version.created_at)}
          </span>
        </div>
        <p className="text-xs text-foreground/80 truncate mt-0.5">{version.title}</p>
      </div>
      {showActions && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRestore()
            }}
            disabled={isRestoring}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Restore"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
