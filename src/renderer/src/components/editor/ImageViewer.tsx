import { useEffect, useState } from 'react'
import { FileImage, RotateCcw } from 'lucide-react'

export interface ImageViewerProps {
  /**
   * The gt-file:// host id: a document id (v2 tree artifact). The protocol
   * resolves it to the file on disk and streams the bytes.
   */
  gtFileId: string
  fileName?: string
  /**
   * When set (v2 artifact docs), subscribe to `documents:content-changed` and
   * bump `reloadKey` (the `?v=` cache-bust) when THIS doc's bytes change on disk
   * (agent rewrite, external edit). Omitted for unwatched tabs.
   */
  watchDocId?: string
}

/**
 * Renders an image artifact via a plain `<img src="gt-file://...">`. SVG is
 * intentionally routed through `<img>` (which never executes embedded SVG
 * script) and MUST NOT be moved to an iframe/srcdoc render path. The renderer
 * CSP grants `gt-file:` to `img-src` so the stream loads.
 *
 * This component never touches the documents pipeline. Live-reload is a one-way
 * signal: when the watched doc's bytes change we bump `reloadKey`, which changes
 * the `?v=` query so the differing URL defeats Chromium's cache; the reload
 * button does the same manually.
 */
export function ImageViewer({ gtFileId, fileName, watchDocId }: ImageViewerProps) {
  const [reloadKey, setReloadKey] = useState(0)
  const [actualSize, setActualSize] = useState(false)

  useEffect(() => {
    if (!watchDocId) return
    return window.api.onDocumentContentChanged((data) => {
      if (data.id === watchDocId) setReloadKey((k) => k + 1)
    })
  }, [watchDocId])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b dark:border-white/5 border-black/5 bg-muted/50 shrink-0">
        <FileImage className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">
          {fileName ?? 'Image preview'}
        </span>
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
      <div
        className={
          actualSize
            ? 'flex-1 min-h-0 overflow-auto bg-muted/20'
            : 'flex-1 min-h-0 overflow-hidden flex items-center justify-center bg-muted/20'
        }
      >
        <img
          src={`gt-file://${gtFileId}/?v=${reloadKey}`}
          alt={fileName ?? 'Image preview'}
          onClick={() => setActualSize((s) => !s)}
          className={
            actualSize
              ? 'max-w-none cursor-zoom-out'
              : 'max-w-full max-h-full object-contain cursor-zoom-in'
          }
        />
      </div>
    </div>
  )
}

export default ImageViewer
