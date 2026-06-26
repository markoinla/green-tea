import { useEffect, useState } from 'react'
import { FileText, RotateCcw } from 'lucide-react'

export interface PdfViewerProps {
  /**
   * The gt-file:// host id: a document id (v2 tree artifact). The protocol
   * resolves it to the file on disk and serves it as `application/pdf` so
   * Chromium's bundled PDF viewer engages.
   */
  gtFileId: string
  fileName?: string
  /**
   * When set (v2 artifact docs), subscribe to `documents:content-changed` and
   * remount the iframe (via `reloadKey`) when THIS doc's bytes change on disk.
   * Note: a remount re-initializes the native viewer, resetting scroll/zoom.
   */
  watchDocId?: string
}

/**
 * Renders a PDF artifact in a sandboxed iframe served by the `gt-file://`
 * protocol, relying on Chromium's bundled PDF viewer (enabled via
 * `webPreferences.plugins: true`). Effectively `HtmlViewer` minus the
 * element-picker/postMessage machinery.
 *
 * Unlike HtmlViewer (which sandboxes agent-authored HTML to an opaque origin),
 * the PDF frame is deliberately NOT sandboxed: Chromium renders PDFs through its
 * internal viewer plugin, and a sandboxed iframe blocks plugins outright (the
 * gt-file load fails with ERR_BLOCKED_BY_CLIENT and the frame stays blank — no
 * sandbox token re-enables plugins). Dropping the sandbox is safe here because the
 * framed bytes are a PDF (not executable HTML), the gt-file response for non-HTML
 * carries no CSP, and no preload runs in gt-file frames so `window.api` is
 * unreachable regardless of origin.
 *
 * This component never touches the documents pipeline. Live-reload is a one-way
 * signal: when the watched doc's bytes change we bump `reloadKey` to force a
 * full remount; the reload button does the same manually.
 */
export function PdfViewer({ gtFileId, fileName, watchDocId }: PdfViewerProps) {
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!watchDocId) return
    return window.api.onDocumentContentChanged((data) => {
      if (data.id === watchDocId) setReloadKey((k) => k + 1)
    })
  }, [watchDocId])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b dark:border-white/5 border-black/5 bg-muted/50 shrink-0">
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{fileName ?? 'PDF preview'}</span>
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
          // `#toolbar=0` hides Chromium's native PDF toolbar — its title field shows
          // the PDF's embedded /Title metadata (often garbage, e.g. the data: URL of
          // an app-exported PDF), which we can't override. Our own header above shows
          // the clean filename instead. Scroll + pinch/ctrl-wheel zoom still work.
          src={`gt-file://${gtFileId}/?v=${reloadKey}#toolbar=0`}
          title={fileName ?? 'PDF preview'}
          className="w-full h-full border-0"
        />
      </div>
    </div>
  )
}

export default PdfViewer
