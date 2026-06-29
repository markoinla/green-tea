import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { resolveLucideIcon } from '../artifacts/lucide-icon'
import { registerSnapshotProvider } from '../artifacts/registry'
import type { ViewerContribution } from '../../../../main/plugins/types'
import type { Document } from '../../../../main/database/types'

/**
 * Full-pane viewer for a plugin-contributed artifact kind. The plugin's viewer
 * HTML is served by the `gt-plugin://<pluginId>/` protocol; this component mounts
 * it in a sandboxed iframe (`allow-scripts allow-same-origin`) and bridges the
 * file bytes over a `postMessage` protocol.
 *
 * Sandbox tokens: `allow-scripts` runs the viewer; `allow-same-origin` gives the
 * frame its real `gt-plugin://<pluginId>` origin so viewers get persistent,
 * per-plugin web storage (localStorage/IndexedDB) for things like a theme pref.
 * This is safe here because the plugin origin (`gt-plugin://<pluginId>`) is NOT
 * the host renderer's origin (`file://` in prod, `http://localhost` in dev), so
 * the classic `allow-scripts allow-same-origin` escape — content removing its own
 * sandbox / reaching the embedder — does not apply: the frame stays cross-origin
 * to the parent. `window.api` is unreachable regardless of these tokens because
 * `nodeIntegrationInSubFrames` is false (the preload never runs in subframes), and
 * network access stays constrained by the CSP the gt-plugin:// handler emits.
 * Storage is keyed by plugin origin, so uninstall clears it via clearStorageData.
 *
 *   frame → host  {type:'gt:ready'}                             (listener attached)
 *   host → frame  {type:'gt:init', bytes, fileName, editable}   (on load + on gt:ready)
 *   frame → host  {type:'gt:save', bytes}                       (editable plugins)
 *   frame → host  {type:'gt:quote', text}                       (selection → chat)
 *   host → frame  {type:'gt:render-static'}                     (share: request snapshot)
 *   frame → host  {type:'gt:static', html}                      (self-contained, read-only)
 *   frame → host  {type:'gt:secret-get', subKey}               (needs "secrets" permission)
 *   host → frame  {type:'gt:secret-value', subKey, value}       (reply, origin-pinned)
 *   frame → host  {type:'gt:secret-set', subKey, value}
 *   frame → host  {type:'gt:secret-delete', subKey}
 *   frame → host  {type:'gt:secret-list'}
 *   host → frame  {type:'gt:secret-keys', subKeys}              (reply, origin-pinned)
 *
 * The `gt:render-static`/`gt:static` round-trip lets the share UI ask the LIVE
 * frame for a frozen, host-less HTML snapshot of its current state (publishing
 * stays a USER action via ShareControl). Only the plugin knows how to render its
 * kind, so it owns snapshot production — same contract as the canvas exporter.
 * A plugin that doesn't implement it simply never replies, so {@link requestSnapshot}
 * rejects on a timeout rather than hanging the publish flow.
 *
 * `gt:init` is sent both on the iframe `load` event AND in reply to the frame's
 * `gt:ready` handshake — `load` can fire before the viewer's module script has
 * attached its `message` listener (its imports may still be in flight), so a
 * load-only init can be dropped and blank the frame.
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

interface PendingSnapshot {
  resolve: (html: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** How long to wait for a `gt:static` reply before assuming the plugin can't snapshot. */
const SNAPSHOT_TIMEOUT_MS = 10000

export function PluginViewer({ contribution, doc, onQuoteSelection }: PluginViewerProps) {
  const [reloadKey, setReloadKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pendingSnapshotRef = useRef<PendingSnapshot | null>(null)

  // The message listener (registered once per doc) reads the live contribution —
  // its pluginId (the trusted, host-known identity) and declared permissions —
  // through this ref so we never honor a stale value if the prop changes.
  const contributionRef = useRef(contribution)
  useEffect(() => {
    contributionRef.current = contribution
  }, [contribution])

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

  // --- snapshot: ask the live frame for a self-contained static page ---------
  // The share UI (ShareControl → plugin-share) calls this on the USER's publish
  // click. We post `gt:render-static` and resolve with the frame's `gt:static`
  // html reply (matched in the message handler below). A plugin that doesn't
  // implement the handler never replies, so we reject on a timeout rather than
  // leaving publish hung. Stable identity (empty deps) so the registration effect
  // re-runs only on doc change, not on every render.
  const requestSnapshot = useCallback((): Promise<string> => {
    const frame = iframeRef.current?.contentWindow
    if (!frame) return Promise.reject(new Error('Viewer not mounted'))
    // One snapshot in flight at a time — supersede any prior pending request.
    const prior = pendingSnapshotRef.current
    if (prior) {
      clearTimeout(prior.timer)
      prior.reject(new Error('Snapshot superseded'))
      pendingSnapshotRef.current = null
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingSnapshotRef.current?.timer === timer) pendingSnapshotRef.current = null
        // The kind is already known shareable (the share UI gates on it), so a missing
        // reply means the plugin's snapshot was too slow or its gt:render-static handler
        // is broken/absent — a timeout, not "unsupported".
        reject(new Error('Timed out building a shareable snapshot of this artifact'))
      }, SNAPSHOT_TIMEOUT_MS)
      pendingSnapshotRef.current = { resolve, reject, timer }
      frame.postMessage({ type: 'gt:render-static' }, '*')
    })
  }, [])

  // Expose the snapshot capability to the (decoupled) share UI, keyed by doc id.
  // ShareControl lives far away in the header and has no ref to this frame, so it
  // looks the provider up by the active doc id at publish time.
  useEffect(() => registerSnapshotProvider(doc.id, requestSnapshot), [doc.id, requestSnapshot])

  // --- inbound messages from the plugin frame -------------------------------
  // Every message is UNTRUSTED. The frame is sandboxed with `allow-scripts` only,
  // so it runs at an opaque origin and its messages arrive with `event.origin ===
  // 'null'` — an origin-string check would reject everything. Authenticate instead
  // by window identity: `event.source` is this exact iframe's contentWindow object,
  // which no other page can forge. That identity check is necessary and sufficient.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as {
        type?: unknown
        bytes?: unknown
        text?: unknown
        html?: unknown
        subKey?: unknown
        value?: unknown
      }
      if (!data || typeof data.type !== 'string') return
      // Handshake: the frame posts `gt:ready` once its message listener is wired
      // up (which can be AFTER the iframe `load` event, since the viewer's module
      // script may still be fetching deps over the network when `load` fires).
      // Re-send the init bytes here so delivery never races listener attachment —
      // `onLoad` alone can drop the first `gt:init`, leaving a blank frame. render
      // is idempotent (renderSeq-guarded), so a duplicate init is harmless.
      if (data.type === 'gt:ready') {
        initFrame()
        return
      }
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
        return
      }
      // Snapshot reply to a `gt:render-static` request — a self-contained,
      // read-only HTML page that the share flow publishes verbatim.
      if (data.type === 'gt:static') {
        if (typeof data.html !== 'string') return
        const pending = pendingSnapshotRef.current
        if (pending) {
          clearTimeout(pending.timer)
          pending.resolve(data.html)
          pendingSnapshotRef.current = null
        }
        return
      }
      // Plugin-scoped secrets (§4.9.1): a mediated, capability-gated, origin-pinned
      // bridge. Unlike the byte/quote/snapshot messages (which carry vault-local
      // content), these touch the encrypted secrets store, so we additionally:
      //   - require `event.origin === gt-plugin://<pluginId>` (not just the
      //     event.source identity check above), so a self-navigated frame at a
      //     foreign origin can never receive secrets;
      //   - require the plugin to have declared the "secrets" permission;
      //   - reply with an EXPLICIT targetOrigin (never '*').
      // The main process re-verifies all of this server-side regardless.
      if (
        data.type === 'gt:secret-get' ||
        data.type === 'gt:secret-set' ||
        data.type === 'gt:secret-delete' ||
        data.type === 'gt:secret-list'
      ) {
        const c = contributionRef.current
        const expectedOrigin = `gt-plugin://${c.pluginId}`
        if (event.origin !== expectedOrigin) return
        if (!(c.permissions ?? []).includes('secrets')) return
        const frame = iframeRef.current?.contentWindow
        if (!frame) return
        const subKey = typeof data.subKey === 'string' ? data.subKey : undefined

        if (data.type === 'gt:secret-get') {
          if (subKey === undefined) return
          window.api.plugins
            .secretGet(c.pluginId, subKey)
            .then((value) =>
              frame.postMessage({ type: 'gt:secret-value', subKey, value }, expectedOrigin)
            )
            .catch((err: unknown) => console.error('[plugin] secret get failed', err))
        } else if (data.type === 'gt:secret-set') {
          if (subKey === undefined || typeof data.value !== 'string') return
          window.api.plugins
            .secretSet(c.pluginId, subKey, data.value)
            .catch((err: unknown) => console.error('[plugin] secret set failed', err))
        } else if (data.type === 'gt:secret-delete') {
          if (subKey === undefined) return
          window.api.plugins
            .secretDelete(c.pluginId, subKey)
            .catch((err: unknown) => console.error('[plugin] secret delete failed', err))
        } else {
          window.api.plugins
            .secretList(c.pluginId)
            .then((subKeys) =>
              frame.postMessage({ type: 'gt:secret-keys', subKeys }, expectedOrigin)
            )
            .catch((err: unknown) => console.error('[plugin] secret list failed', err))
        }
        return
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [doc.id, onQuoteSelection, initFrame, contribution.pluginId])

  // Toolbar icon mirrors the file-tree icon: the plugin manifest's `icon` (a lucide
  // name) resolved through the shared resolver, so both surfaces stay consistent.
  const Icon = resolveLucideIcon(contribution.icon)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b dark:border-white/5 border-black/5 bg-muted/50 shrink-0">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
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
          sandbox="allow-scripts allow-same-origin"
          title={doc.title}
          className="w-full h-full border-0"
          onLoad={initFrame}
        />
      </div>
    </div>
  )
}

export default PluginViewer
