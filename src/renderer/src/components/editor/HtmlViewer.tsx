import { useState } from 'react'
import { FileCode, RotateCcw } from 'lucide-react'

export interface HtmlViewerProps {
  workspaceFileId: string
  fileName?: string
}

/**
 * Renders a workspace HTML artifact in a sandboxed iframe served by the
 * `gt-file://` protocol. The sandbox is EXACTLY `allow-scripts` — the opaque
 * (null) origin is what actually blocks `window.api` + storage access, so we
 * never add `allow-same-origin`, `allow-popups`, `allow-top-navigation`, or
 * `allow-modals`.
 *
 * This component never touches the documents pipeline: no `useDocument`,
 * no `useAutosave`. Live-reload is a v2 concern — `reloadKey` is kept as the
 * iframe key so a future watcher signal can force a full re-render, and the
 * reload button bumps it manually.
 */
export function HtmlViewer({ workspaceFileId, fileName }: HtmlViewerProps) {
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b dark:border-white/5 border-black/5 bg-muted/50 shrink-0">
        <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{fileName ?? 'HTML preview'}</span>
        <div className="flex-1" />
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          title="Reload"
        >
          <RotateCcw className="h-3 w-3" />
          Reload
        </button>
      </div>
      <div className="flex-1 min-h-0 bg-white">
        <iframe
          key={reloadKey}
          src={`gt-file://${workspaceFileId}/`}
          sandbox="allow-scripts"
          title={fileName ?? 'HTML preview'}
          className="w-full h-full border-0"
        />
      </div>
    </div>
  )
}

export default HtmlViewer
