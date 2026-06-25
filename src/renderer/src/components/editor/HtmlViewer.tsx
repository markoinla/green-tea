import { useEffect, useRef, useState } from 'react'
import { FileCode, MousePointerSquareDashed, RotateCcw } from 'lucide-react'
import { formatPickedSelection } from './picker-selection'

export interface HtmlViewerProps {
  /**
   * The gt-file:// host id: a workspace-file id (v1, Files section) or a document
   * id (v2, a tree artifact). The protocol resolves both.
   */
  gtFileId: string
  fileName?: string
  /**
   * When set (v2 artifact docs), subscribe to `documents:content-changed` and
   * hard-reload the iframe when THIS doc's bytes change on disk (agent rewrite,
   * external edit). Omitted for v1 workspace-file tabs, which aren't watched.
   */
  watchDocId?: string
  /**
   * Called with a formatted one-liner when the user picks an element in inspect
   * mode (mirrors `DocumentEditor`). Lands in the existing chat `selectionContext`
   * rail — the picker is a new producer on an existing rail.
   */
  onQuoteSelection?: (text: string) => void
}

/**
 * Renders an HTML artifact in a sandboxed iframe served by the `gt-file://`
 * protocol. The sandbox is EXACTLY `allow-scripts` — the opaque (null) origin is
 * what actually blocks `window.api` + storage access, so we never add
 * `allow-same-origin`, `allow-popups`, `allow-top-navigation`, or `allow-modals`.
 *
 * This component never touches the documents pipeline: no `useDocument`,
 * no `useAutosave`. Live-reload (v2) is a one-way signal — when the watched doc's
 * content changes we bump `reloadKey` to force a full re-render; the reload
 * button does the same manually.
 */
export function HtmlViewer({ gtFileId, fileName, watchDocId, onQuoteSelection }: HtmlViewerProps) {
  const [reloadKey, setReloadKey] = useState(0)
  const [inspect, setInspect] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!watchDocId) return
    return window.api.onDocumentContentChanged((data) => {
      if (data.id === watchDocId) setReloadKey((k) => k + 1)
    })
  }, [watchDocId])

  // Turn inspect off across a manual reload — the remounted frame reloads dormant.
  useEffect(() => {
    setInspect(false)
  }, [reloadKey])

  // Tell the (re)loaded frame the current inspect state. The frame is opaque-origin,
  // so targetOrigin is '*' — the payload is a non-secret boolean (see the plan).
  const postInspect = (on: boolean) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: 'gt-element-picker', type: 'set-inspect', on },
      '*'
    )
  }

  const toggleInspect = () => {
    const next = !inspect
    setInspect(next)
    postInspect(next)
  }

  // Every iframe message is UNTRUSTED — the artifact shares the frame's JS realm with
  // the picker bootstrap and could forge a message. Authenticate by window identity
  // (event.source) here; the payload shape-check + length re-clamp lives in the pure,
  // unit-tested `formatPickedSelection`.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const formatted = formatPickedSelection(event.data)
      if (!formatted) return
      onQuoteSelection?.(formatted)
      setInspect(false)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onQuoteSelection])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b dark:border-white/5 border-black/5 bg-muted/50 shrink-0">
        <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{fileName ?? 'HTML preview'}</span>
        <div className="flex-1" />
        <button
          onClick={toggleInspect}
          className={
            inspect
              ? 'text-xs text-foreground transition-colors flex items-center gap-1'
              : 'text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1'
          }
          title="Inspect element"
        >
          <MousePointerSquareDashed className="h-3 w-3" />
          Inspect
        </button>
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
          ref={iframeRef}
          src={`gt-file://${gtFileId}/`}
          sandbox="allow-scripts"
          title={fileName ?? 'HTML preview'}
          className="w-full h-full border-0"
          onLoad={() => postInspect(inspect)}
        />
      </div>
    </div>
  )
}

export default HtmlViewer
