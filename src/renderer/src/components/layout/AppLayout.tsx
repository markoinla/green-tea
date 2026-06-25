import { useState, useCallback, useEffect, useRef } from 'react'
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  useSidebar
} from '@renderer/components/ui/sidebar'
import { LeftSidebar } from './LeftSidebar'
import { RightSidebar } from './RightSidebar'
import { TabStrip, VersionHistoryButton } from './TabStrip'
import { cn } from '@renderer/lib/utils'
import { UpdateBanner } from './UpdateBanner'
import { VersionHistoryPanel } from '../VersionHistoryPanel'
import type { DocumentVersion } from '../../../../main/database/types'

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 480
const HOVER_LEAVE_DELAY = 300

interface AppLayoutProps {
  selectedWorkspaceId: string | null
  onSelectWorkspace: (id: string) => void
  onSelectDoc: (id: string, opts?: { newTab?: boolean }) => void
  openDocIds: string[]
  activeDocId: string | null
  onActivateTab: (id: string) => void
  onCloseTab: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseToRight: (id: string) => void
  onCloseAll: () => void
  onReorderTab: (from: number, to: number) => void
  versionHistoryOpen: boolean
  onVersionHistoryOpenChange: (open: boolean) => void
  onPreviewVersion: (version: DocumentVersion | null) => void
  activePreviewId: string | null
  selectionContext?: string | null
  onClearSelection?: () => void
  children: React.ReactNode
}

export function AppLayout({
  selectedWorkspaceId,
  onSelectWorkspace,
  onSelectDoc,
  openDocIds,
  activeDocId,
  onActivateTab,
  onCloseTab,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onReorderTab,
  versionHistoryOpen,
  onVersionHistoryOpenChange,
  onPreviewVersion,
  activePreviewId,
  selectionContext,
  onClearSelection,
  children
}: AppLayoutProps) {
  const [leftWidth, setLeftWidth] = useState(256)
  const [rightWidth, setRightWidth] = useState(420)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  const resizingRef = useRef<'left' | 'right' | null>(null)
  const [isResizing, setIsResizing] = useState(false)

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

  const hasDoc = activeDocId !== null
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

  return (
    <div className="flex flex-col h-screen">
      <UpdateBanner />
      <SidebarProvider
        className="flex-1 min-h-0"
        open={sidebarOpen}
        onOpenChange={handleSidebarOpenChange}
      >
        <LeftSidebar
          selectedDocId={activeDocId}
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
            className="flex h-10 shrink-0 items-center pl-3 pr-2 relative border-b dark:border-white/5 border-black/5 bg-sidebar"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <div
              className="flex items-center shrink-0 mr-1"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <SidebarTrigger className="-ml-1 text-muted-foreground/70 hover:text-foreground transition-colors" />
            </div>
            <TabStrip
              workspaceId={selectedWorkspaceId}
              openDocIds={openDocIds}
              activeDocId={activeDocId}
              onActivate={onActivateTab}
              onClose={onCloseTab}
              onCloseOthers={onCloseOthers}
              onCloseToRight={onCloseToRight}
              onCloseAll={onCloseAll}
              onReorder={onReorderTab}
            />
            {hasDoc && (
              <div
                className="flex items-center shrink-0 ml-1"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <VersionHistoryButton onClick={() => onVersionHistoryOpenChange(true)} />
              </div>
            )}
          </header>
          <main className="flex flex-col flex-1 min-h-0 overflow-hidden">{children}</main>
        </SidebarInset>
        <RightSidebar
          documentId={activeDocId}
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
        documentId={activeDocId}
        open={versionHistoryOpen}
        onOpenChange={onVersionHistoryOpenChange}
        onPreviewVersion={onPreviewVersion}
        activePreviewId={activePreviewId}
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
