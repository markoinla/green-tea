import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { JSONContent } from '@tiptap/react'
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  useSidebar
} from '@renderer/components/ui/sidebar'
import { LeftSidebar } from './LeftSidebar'
import { RightSidebar } from './RightSidebar'
import { cn } from '@renderer/lib/utils'
import { useDocument } from '@renderer/hooks/useDocument'
import { UpdateBanner } from './UpdateBanner'
import { VersionHistoryPanel, formatRelativeTime, sourceLabel } from '../VersionHistoryPanel'
import { OutlinerEditor } from '../editor/OutlinerEditor'
import { X, History, ArrowLeft, RotateCcw } from 'lucide-react'
import type { DocumentVersion } from '../../../../main/database/types'

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 480
const HOVER_LEAVE_DELAY = 300

interface AppLayoutProps {
  selectedDocId: string | null
  selectedWorkspaceId: string | null
  onSelectDoc: (id: string | null) => void
  onSelectWorkspace: (id: string) => void
  selectionContext?: string | null
  onClearSelection?: () => void
  children: React.ReactNode
}

export function AppLayout({
  selectedDocId,
  selectedWorkspaceId,
  onSelectDoc,
  onSelectWorkspace,
  selectionContext,
  onClearSelection,
  children
}: AppLayoutProps) {
  const [leftWidth, setLeftWidth] = useState(256)
  const [rightWidth, setRightWidth] = useState(420)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  const resizingRef = useRef<'left' | 'right' | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
  const [previewVersion, setPreviewVersion] = useState<DocumentVersion | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [leftHoverExpanded, setLeftHoverExpanded] = useState(false)
  const [rightHoverExpanded, setRightHoverExpanded] = useState(false)
  const leftLeaveTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const rightLeaveTimer = useRef<ReturnType<typeof setTimeout>>(null)

  const handleLeftHover = useCallback((hovered: boolean) => {
    if (leftLeaveTimer.current) {
      clearTimeout(leftLeaveTimer.current)
      leftLeaveTimer.current = null
    }
    if (hovered) {
      setLeftHoverExpanded(true)
    } else {
      leftLeaveTimer.current = setTimeout(() => setLeftHoverExpanded(false), HOVER_LEAVE_DELAY)
    }
  }, [])

  const handleRightHover = useCallback((hovered: boolean) => {
    if (rightLeaveTimer.current) {
      clearTimeout(rightLeaveTimer.current)
      rightLeaveTimer.current = null
    }
    if (hovered) {
      setRightHoverExpanded(true)
    } else {
      rightLeaveTimer.current = setTimeout(() => setRightHoverExpanded(false), HOVER_LEAVE_DELAY)
    }
  }, [])

  // Reset hover state when sidebars are permanently toggled open
  const handleSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open)
    if (open) {
      setLeftHoverExpanded(false)
      setRightHoverExpanded(false)
    }
  }, [])

  const { document: currentDoc } = useDocument(selectedDocId)

  const hasDoc = selectedDocId !== null
  const chatWidth = hasDoc ? rightWidth : windowWidth - leftWidth

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!resizingRef.current) return
    e.preventDefault()
    if (resizingRef.current === 'left') {
      setLeftWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, e.clientX)))
    } else {
      setRightWidth(
        Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - e.clientX))
      )
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    resizingRef.current = null
    setIsResizing(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const startResize = useCallback((side: 'left' | 'right') => {
    resizingRef.current = side
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const handleTitleDoubleClick = useCallback(() => {
    if (!currentDoc) return
    setEditTitle(currentDoc.title)
    setIsEditingTitle(true)
  }, [currentDoc])

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isEditingTitle])

  const handleTitleSubmit = useCallback(() => {
    if (!selectedDocId) return
    const trimmed = editTitle.trim()
    if (trimmed && currentDoc && trimmed !== currentDoc.title) {
      window.api.documents.update(selectedDocId, { title: trimmed })
    }
    setIsEditingTitle(false)
  }, [selectedDocId, editTitle, currentDoc])

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleTitleSubmit()
      } else if (e.key === 'Escape') {
        setIsEditingTitle(false)
      }
    },
    [handleTitleSubmit]
  )

  // Preview is only active when it belongs to the currently open document
  const activePreview =
    previewVersion && previewVersion.document_id === selectedDocId ? previewVersion : null

  const previewContent = useMemo<JSONContent | undefined>(() => {
    if (!activePreview?.content) return undefined
    try {
      return JSON.parse(activePreview.content) as JSONContent
    } catch {
      return undefined
    }
  }, [activePreview])

  const handleVersionHistoryOpenChange = useCallback((open: boolean) => {
    setVersionHistoryOpen(open)
    if (!open) setPreviewVersion(null)
  }, [])

  const handlePreviewRestore = useCallback(async () => {
    if (!activePreview) return
    await window.api.documentVersions.restore(activePreview.id)
    setPreviewVersion(null)
  }, [activePreview])

  return (
    <div className="flex flex-col h-screen">
      <UpdateBanner />
      <SidebarProvider
        className="flex-1 min-h-0"
        open={sidebarOpen}
        onOpenChange={handleSidebarOpenChange}
      >
        <LeftSidebar
          selectedDocId={selectedDocId}
          onSelectDoc={onSelectDoc}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectWorkspace={onSelectWorkspace}
          width={leftWidth}
          resizing={isResizing}
          hoverExpanded={leftHoverExpanded}
          onHoverChange={handleLeftHover}
        />
        <SidebarInset
          className={cn(
            'min-w-0 overflow-hidden transition-opacity duration-200',
            !hasDoc && 'opacity-0'
          )}
        >
          <header
            className="flex h-10 shrink-0 items-center px-3 relative border-b dark:border-white/5 border-black/5 bg-sidebar"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <div
              className="flex items-center"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <SidebarTrigger className="-ml-1 text-muted-foreground/70 hover:text-foreground transition-colors" />
            </div>
            {currentDoc && (
              <div
                className="absolute left-1/2 -translate-x-1/2 flex items-center max-w-[50%]"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={handleTitleSubmit}
                    onKeyDown={handleTitleKeyDown}
                    className="text-sm font-medium text-foreground bg-transparent px-2 py-0.5 rounded outline-none min-w-[120px] max-w-full text-center hover:bg-muted/50 transition-colors focus:bg-muted/50"
                  />
                ) : (
                  <span
                    className="text-sm font-medium text-foreground/90 truncate cursor-default hover:bg-muted/50 px-2 py-0.5 rounded transition-colors"
                    onDoubleClick={handleTitleDoubleClick}
                  >
                    {currentDoc.title}
                  </span>
                )}
              </div>
            )}
            {currentDoc && (
              <div
                className="ml-auto flex items-center gap-0.5"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <button
                  onClick={() => setVersionHistoryOpen(true)}
                  className="text-muted-foreground hover:text-foreground rounded-sm p-1 transition-colors hover:bg-muted"
                  title="Version history"
                >
                  <History className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onSelectDoc(null)}
                  className="text-muted-foreground hover:text-foreground rounded-sm p-1 transition-colors hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </header>
          <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {activePreview ? (
              <>
                <div className="flex items-center gap-2 px-4 py-2 border-b dark:border-white/5 border-black/5 bg-muted/50 shrink-0">
                  <button
                    onClick={() => setPreviewVersion(null)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Back to editing
                  </button>
                  <div className="flex-1" />
                  <span className="text-xs text-muted-foreground">
                    {sourceLabel(activePreview.source)} version{' \u00B7 '}
                    {formatRelativeTime(activePreview.created_at)}
                  </span>
                  <button
                    onClick={handlePreviewRestore}
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
              </>
            ) : (
              children
            )}
          </main>
        </SidebarInset>
        <RightSidebar
          documentId={selectedDocId}
          workspaceId={selectedWorkspaceId}
          width={chatWidth}
          resizing={isResizing}
          selectionContext={selectionContext}
          onClearSelection={onClearSelection}
          hoverExpanded={rightHoverExpanded}
          onHoverChange={handleRightHover}
        />
        <ResizeHandle side="left" position={leftWidth} onStart={() => startResize('left')} />
        {hasDoc && (
          <ResizeHandle side="right" position={rightWidth} onStart={() => startResize('right')} />
        )}
        {isResizing && <div className="fixed inset-0 z-50 cursor-col-resize" />}
      </SidebarProvider>
      <VersionHistoryPanel
        documentId={selectedDocId}
        open={versionHistoryOpen}
        onOpenChange={handleVersionHistoryOpenChange}
        onPreviewVersion={setPreviewVersion}
        activePreviewId={activePreview?.id ?? null}
      />
    </div>
  )
}

function ResizeHandle({
  side,
  position,
  onStart
}: {
  side: 'left' | 'right'
  position: number
  onStart: () => void
}) {
  const { state } = useSidebar()

  if (state === 'collapsed') return null

  const style: React.CSSProperties =
    side === 'left' ? { left: position - 3 } : { right: position - 3 }

  return (
    <div
      onMouseDown={onStart}
      className="fixed top-0 bottom-0 z-30 w-[6px] cursor-col-resize group/handle"
      style={style}
    >
      <div className="h-full w-px mx-auto transition-colors group-hover/handle:bg-border" />
    </div>
  )
}
