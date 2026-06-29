import { useCallback, useEffect, useRef, useState } from 'react'
import { Puzzle, RotateCcw } from 'lucide-react'
import type { ViewerContribution } from '../../../../main/plugins/types'
import type { Document } from '../../../../main/database/types'

/**
 * Full-pane viewer for a plugin-contributed artifact kind. The plugin's viewer
 * HTML is served by the `gt-plugin://<pluginId>/` protocol; this component mounts
 * it in a sandboxed iframe (EXACTLY `allow-scripts` — the opaque/null origin is
 * what blocks `window.api` + storage access, so we never add `allow-same-origin`
 * or any other token) and bridges the file bytes over a `postMessage` protocol:
 *
 *   host → frame  {type:'gt:init', bytes, fileName, editable}   (on each load)
 *   frame → host  {type:'gt:save', bytes}                       (editable plugins)
 *   frame → host  {type:'gt:quote', text}                       (selection → chat)
 *
 * Bytes flow over the readArtifact/writeArtifact IPCs (NOT gt-plugin:// fetch) so
 * the same live-reload + autosave-by-the-plugin contract as the built-in editable
 * viewers holds: external edits (agent rewrite, another app) live-reload via
 * `onDocumentContentChanged` by hard-reloading the frame, and the freshly read
 * bytes are re-`gt:init`-ed into it.
 */

export interface PluginViewerProps {
  contribution: ViewerContribution
  doc: Document
  onQuoteSelection?: (text: string) => void
}

interface GtInitMessage {
  type: 'gt:init'
  bytes: string
  fileName: string
  editable: boolean
}

export function PluginViewer({ contribution, doc, onQuoteSelection }: PluginViewerProps) {
  const [reloadKey, setReloadKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // --- feed the (re)loaded frame the current bytes --------------------------
  // Read on each frame load (mount + manual reload + live-reload remount) and hand
  // the bytes to the plugin. The frame is opaque-origin, so postMessage targetOrigin
  // is '*' — the payload is the (already vault-local) file content.
  const initFrame = useCallback((): void => {
    const frame = iframeRef.current?.contentWindow
    if (!frame) return
    window.api
      .readArtifactText(doc.id)
      .then((bytes) => {
        const message: GtInitMessage = {
          type: 'gt:init',
          bytes,
          fileName: doc.title,
          editable: contribution.editable
        }
        frame.postMessage(message, '*')
      })
      .catch((err: unknown) => {
        console.error('[plugin] init read failed', err)
      })
  }, [doc.id, doc.title, contribution.editable])

  // --- live-reload: hard-reload the frame when the bytes change on disk ------
  useEffect(() => {
    return window.api.onDocumentContentChanged((data) => {
      if (data.id === doc.id) setReloadKey((k) => k + 1)
    })
  }, [doc.id])

  // --- inbound messages from the plugin frame -------------------------------
  // Every message is UNTRUSTED. The frame is sandboxed with `allow-scripts` only,
  // so it runs at an opaque origin and its messages arrive with `event.origin ===
  // 'null'` — an origin-string check would reject everything. Authenticate instead
  // by window identity: `event.source` is this exact iframe's contentWindow object,
  // which no other page can forge. That identity check is necessary and sufficient.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as { type?: unknown; bytes?: unknown; text?: unknown }
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'gt:save') {
        if (typeof data.bytes !== 'string') return
        window.api.writeArtifact(doc.id, data.bytes).catch((err: unknown) => {
          console.error('[plugin] save failed', err)
        })
        return
      }
      if (data.type === 'gt:quote') {
        if (typeof data.text !== 'string') return
        onQuoteSelection?.(data.text)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [doc.id, onQuoteSelection])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b dark:border-white/5 border-black/5 bg-muted/50 shrink-0">
        <Puzzle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{doc.title}</span>
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
          ref={iframeRef}
          src={`gt-plugin://${contribution.pluginId}/${contribution.entry}`}
          sandbox="allow-scripts"
          title={doc.title}
          className="w-full h-full border-0"
          onLoad={initFrame}
        />
      </div>
    </div>
  )
}

export default PluginViewer
