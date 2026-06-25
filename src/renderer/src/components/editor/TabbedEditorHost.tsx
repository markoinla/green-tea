import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import type { JSONContent } from '@tiptap/react'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useDocument } from '@renderer/hooks/useDocument'
import { useAutosave, hasConflict } from '@renderer/hooks/useAutosave'
import { computeMountedIds } from '@renderer/hooks/tab-state'
import { isFileTabId, parseFileTabId } from '@renderer/lib/tab-ids'
import { useDocuments } from '@renderer/hooks/useDocuments'
import { viewerForKind } from '@renderer/components/artifacts/registry'
import { OutlinerEditor } from './OutlinerEditor'
import { HtmlViewer } from './HtmlViewer'
import { FileConflictDialog } from './FileConflictDialog'
import { formatRelativeTime, sourceLabel } from '../VersionHistoryPanel'
import type { DocumentVersion } from '../../../../main/database/types'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 bg-red-900 text-white m-4 rounded overflow-auto max-h-[50vh]">
          <h2 className="font-bold mb-2">Editor crashed:</h2>
          <pre className="text-xs whitespace-pre-wrap">{this.state.error.message}</pre>
          <pre className="text-xs whitespace-pre-wrap mt-2 opacity-70">
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

function DocumentEditor({
  documentId,
  isActive,
  onQuoteSelection
}: {
  documentId: string
  isActive: boolean
  onQuoteSelection?: (text: string) => void
}) {
  const { document, loading, externalContentVersion, externalContent, conflict, resolveConflict } =
    useDocument(documentId, isActive)
  const save = useAutosave(documentId)

  const initialContent = useMemo(() => {
    if (!document?.content) return undefined
    try {
      return JSON.parse(document.content) as JSONContent
    } catch {
      return undefined
    }
  }, [document?.content])

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    )
  }

  return (
    <>
      <OutlinerEditor
        key={documentId}
        content={initialContent}
        onUpdate={save}
        onQuoteSelection={onQuoteSelection}
        externalContent={externalContent}
        externalContentVersion={externalContentVersion}
        document={document}
      />
      {/* Only the active tab may mount the focus-trapping conflict dialog. */}
      <FileConflictDialog
        open={!!conflict && isActive}
        onReload={() => resolveConflict('reload')}
        onKeepMine={() => resolveConflict('keepMine')}
      />
    </>
  )
}

export interface TabbedEditorHostProps {
  openDocIds: string[]
  activeDocId: string | null
  /** Active workspace — used to resolve each open doc's `kind` for viewer dispatch. */
  workspaceId: string | null
  onQuoteSelection?: (text: string) => void
  /** LRU keep-mounted cap. */
  liveCap?: number
  /** workspace-file id → display name, for HTML artifact (`file:`) tabs. */
  fileNamesById?: Map<string, string>
  /** Active version-history preview (already scoped to the active doc by App). */
  previewVersion: DocumentVersion | null
  onExitPreview: () => void
  onRestorePreview: () => void
}

/**
 * Renders one editor per mounted tab — the active tab visible, the rest mounted
 * but hidden so their cursor/scroll/undo survive a tab switch. A keep-mounted LRU
 * (cap `liveCap`) unmounts the least-recently-active CLEAN tabs; tabs with a
 * pending/deferred conflict are never evicted (eviction must not resolve a
 * conflict by silent overwrite — finding #6).
 *
 * Version-history preview overlays ONLY the active tab's slot, leaving every other
 * editor mounted (finding #7).
 */
export function TabbedEditorHost({
  openDocIds,
  activeDocId,
  workspaceId,
  onQuoteSelection,
  liveCap = 8,
  fileNamesById,
  previewVersion,
  onExitPreview,
  onRestorePreview
}: TabbedEditorHostProps) {
  const [mountedIds, setMountedIds] = useState<string[]>([])

  // Resolve each open doc's `kind` so an artifact tab renders its registry viewer
  // instead of the markdown editor. (Notes and not-yet-loaded ids fall through to
  // DocumentEditor — its hooks read content=null harmlessly until the kind lands.)
  const { documents } = useDocuments(workspaceId)
  const docsById = useMemo(() => {
    const map = new Map<string, (typeof documents)[number]>()
    for (const d of documents) map.set(d.id, d)
    return map
  }, [documents])

  useEffect(() => {
    setMountedIds((prev) => computeMountedIds(prev, openDocIds, activeDocId, liveCap, hasConflict))
  }, [openDocIds, activeDocId, liveCap])

  // Ensure the active tab renders even before the LRU effect commits (no flash).
  const renderIds =
    activeDocId && !mountedIds.includes(activeDocId) ? [...mountedIds, activeDocId] : mountedIds

  const activePreview =
    previewVersion && previewVersion.document_id === activeDocId ? previewVersion : null

  const previewContent = useMemo<JSONContent | undefined>(() => {
    if (!activePreview?.content) return undefined
    try {
      return JSON.parse(activePreview.content) as JSONContent
    } catch {
      return undefined
    }
  }, [activePreview])

  return (
    <div className="flex flex-col flex-1 min-h-0 relative">
      {renderIds.map((id) => {
        const visible = id === activeDocId && !activePreview
        // Branch ABOVE the hooks: a `file:` (v1 Files-section) tab or a v2
        // artifact doc renders a viewer and never mounts DocumentEditor, so
        // useDocument / useAutosave never run for it (Rules of Hooks). The
        // version-preview overlay below is note-only and never matches either.
        const fileId = isFileTabId(id) ? parseFileTabId(id) : null
        const artifactDoc = fileId ? null : docsById.get(id)
        const ArtifactViewer = artifactDoc ? viewerForKind(artifactDoc.kind)?.Viewer : null
        return (
          <div
            key={id}
            className={cn('flex-col flex-1 min-h-0', visible ? 'flex' : 'hidden')}
            aria-hidden={!visible}
          >
            <ErrorBoundary>
              {fileId ? (
                <HtmlViewer
                  gtFileId={fileId}
                  fileName={fileNamesById?.get(fileId)}
                  onQuoteSelection={onQuoteSelection}
                />
              ) : ArtifactViewer && artifactDoc ? (
                <ArtifactViewer doc={artifactDoc} onQuoteSelection={onQuoteSelection} />
              ) : (
                <DocumentEditor
                  documentId={id}
                  isActive={id === activeDocId && !activePreview}
                  onQuoteSelection={onQuoteSelection}
                />
              )}
            </ErrorBoundary>
          </div>
        )
      })}

      {activePreview && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-2 px-4 py-2 border-b dark:border-white/5 border-black/5 bg-muted/50 shrink-0">
            <button
              onClick={onExitPreview}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to editing
            </button>
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground">
              {sourceLabel(activePreview.source)} version{' · '}
              {formatRelativeTime(activePreview.created_at)}
            </span>
            <button
              onClick={onRestorePreview}
              className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="h-3 w-3" />
              Restore
            </button>
          </div>
          <OutlinerEditor
            key={`preview-${activePreview.id}`}
            content={previewContent}
            editable={false}
          />
        </div>
      )}
    </div>
  )
}
