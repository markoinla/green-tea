import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps
} from '@excalidraw/excalidraw/types'
import { registerFlusher } from '../../hooks/useAutosave'

/**
 * Full-pane viewer for a `.excalidraw` canvas artifact — the first EDITABLE
 * artifact. It mounts the Excalidraw React component, loads the file's JSON as
 * `initialData`, and autosaves scene changes back to the same file (debounced +
 * flushed) through the generic `documents:writeArtifact` IPC. External edits
 * (the agent rewriting the file, another app) live-reload via the vault watcher
 * → `onDocumentContentChanged`, applied with `updateScene` so the viewport is
 * preserved. Our own saves never come back here (suppressed by `markSelfWrite`).
 *
 * Excalidraw is a large dep (~47MB unpacked), so the component AND its CSS are
 * dynamically imported — they stay out of the main editor bundle and load only
 * when a canvas opens.
 */

// Set the asset path ONCE, before Excalidraw loads, so it fetches its bundled
// fonts from next to the app's index.html (offline) instead of the default CDN.
// Derived from the document base URL so it works under both the dev http server
// and the production file:// load. The fonts are copied next to index.html by
// the renderer build (see the excalidraw-assets plugin in electron.vite.config).
{
  const w = window as unknown as { EXCALIDRAW_ASSET_PATH?: string | string[] }
  if (!w.EXCALIDRAW_ASSET_PATH) {
    w.EXCALIDRAW_ASSET_PATH = new URL('.', window.location.href).href
  }
}

type ExcalidrawModule = typeof import('@excalidraw/excalidraw')
type ChangeArgs = Parameters<NonNullable<ExcalidrawProps['onChange']>>

const SAVE_DEBOUNCE_MS = 800
// While the user is mid-stroke (pointer down) or has just changed something, an
// external reload is deferred so it can't yank the scene out from under them.
const INTERACTION_QUIET_MS = 1200

export interface CanvasViewerProps {
  /** The artifact host id (a document id). Bytes flow over the readArtifact/
   *  writeArtifact IPCs — the renderer CSP blocks gt-file:// `connect-src`. */
  gtFileId: string
  fileName?: string
  /** When set, subscribe to `documents:content-changed` and live-reload when
   *  THIS doc's bytes change on disk (agent rewrite, external edit). */
  watchDocId?: string
}

/** Read the app's current chrome theme from the `dark` class on <html>. */
function readChromeTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function CanvasViewer({ gtFileId, fileName, watchDocId }: CanvasViewerProps) {
  const [mod, setMod] = useState<ExcalidrawModule | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(readChromeTheme)

  const modRef = useRef<ExcalidrawModule | null>(null)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const latestRef = useRef<ChangeArgs | null>(null)
  // The serialized form of what's on disk. Compared like-for-like against
  // serializeAsJSON output so an edit-free flush is a no-op. Advanced ONLY after a
  // write succeeds, so a failed write leaves it stale and the edit is retried.
  const lastSavedRef = useRef<string | null>(null)
  // Excalidraw fires onChange once after we feed it a scene (mount or external
  // reload) — that echo is the loaded scene, not a user edit, so the first
  // onChange after a (re)load adopts the serialized baseline instead of writing.
  const baselinePendingRef = useRef(true)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastInteractionRef = useRef(0)
  const pointerDownRef = useRef(false)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- lazy-load Excalidraw (component + CSS) -------------------------------
  useEffect(() => {
    let cancelled = false
    Promise.all([import('@excalidraw/excalidraw'), import('@excalidraw/excalidraw/index.css')])
      .then(([m]) => {
        if (cancelled) return
        modRef.current = m
        setMod(m)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // --- load the scene from disk --------------------------------------------
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    // The scene we're about to feed Excalidraw will echo back via onChange; treat
    // that echo as the baseline, not an edit.
    baselinePendingRef.current = true
    window.api
      .readArtifactText(gtFileId)
      .then((text) => {
        if (cancelled) return
        const scene = JSON.parse(text) as Partial<ExcalidrawInitialDataState>
        setInitialData({
          elements: scene.elements ?? [],
          appState: scene.appState ?? {},
          files: scene.files ?? undefined,
          scrollToContent: true
        })
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [gtFileId])

  // --- follow the chrome theme (chrome only; never remap scene colors) ------
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readChromeTheme()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    })
    return () => observer.disconnect()
  }, [])

  // --- autosave: serialize the latest scene and write it back --------------
  const flush = useCallback((): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const m = modRef.current
    const payload = latestRef.current
    if (!m || !payload) return Promise.resolve()
    const json = m.serializeAsJSON(payload[0], payload[1], payload[2], 'local')
    // Skip the write when nothing actually changed since the last save/load — so a
    // blur/visibility flush with no edits doesn't churn the file.
    if (json === lastSavedRef.current) return Promise.resolve()
    // Advance the baseline ONLY after the write resolves: if it fails, the stale
    // baseline lets the next flush retry rather than silently dropping the edit.
    return window.api.writeArtifact(gtFileId, json).then(
      () => {
        lastSavedRef.current = json
      },
      (err: unknown) => {
        console.error('[canvas] autosave failed', err)
      }
    )
  }, [gtFileId])

  const handleChange = useCallback<NonNullable<ExcalidrawProps['onChange']>>(
    (elements, appState, files) => {
      latestRef.current = [elements, appState, files]
      // First onChange after a (re)load is Excalidraw echoing the scene we fed it —
      // adopt its serialized form as the saved baseline instead of writing it back.
      if (baselinePendingRef.current) {
        baselinePendingRef.current = false
        const m = modRef.current
        if (m) lastSavedRef.current = m.serializeAsJSON(elements, appState, files, 'local')
        return
      }
      lastInteractionRef.current = Date.now()
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
    },
    [flush]
  )

  // Flush on unmount (tab close / app close) and on window hide. Also register
  // into the global flush registry so the quit handshake awaits this write too.
  useEffect(() => {
    const onHide = (): void => void flush()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') void flush()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    const unregister = registerFlusher(gtFileId, flush)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      unregister()
      void flush()
    }
  }, [gtFileId, flush])

  // --- external reload: re-read and apply, deferred while interacting -------
  const applyExternal = useCallback((): void => {
    const api = apiRef.current
    if (!api) return
    // Don't interrupt an active stroke or a just-finished edit; retry shortly.
    if (pointerDownRef.current || Date.now() - lastInteractionRef.current < INTERACTION_QUIET_MS) {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(applyExternal, INTERACTION_QUIET_MS)
      return
    }
    window.api
      .readArtifactText(gtFileId)
      .then((text) => {
        const api2 = apiRef.current
        if (!api2) return
        const scene = JSON.parse(text) as ExcalidrawInitialDataState
        // Strip viewport keys so updateScene preserves the user's current pan/zoom
        // rather than jumping to the saved viewport.
        const appState: Record<string, unknown> = { ...(scene.appState ?? {}) }
        delete appState.scrollX
        delete appState.scrollY
        delete appState.zoom
        // updateScene will echo via onChange; adopt that echo as the new baseline
        // so we don't immediately write the just-reloaded scene back to disk.
        baselinePendingRef.current = true
        api2.updateScene({ elements: scene.elements ?? [], appState } as Parameters<
          ExcalidrawImperativeAPI['updateScene']
        >[0])
        if (scene.files) api2.addFiles(Object.values(scene.files))
      })
      .catch((err: unknown) => {
        console.error('[canvas] external reload failed', err)
      })
  }, [gtFileId])

  useEffect(() => {
    if (!watchDocId) return
    return window.api.onDocumentContentChanged((data) => {
      if (data.id === watchDocId) applyExternal()
    })
  }, [watchDocId, applyExternal])

  useEffect(() => {
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
    }
  }, [])

  if (status === 'error') {
    return (
      <div className="flex flex-col flex-1 min-h-0 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="text-sm text-foreground">Couldn’t open this canvas.</p>
          {error && <p className="mt-1 text-xs text-muted-foreground break-words">{error}</p>}
        </div>
      </div>
    )
  }

  const Excalidraw = mod?.Excalidraw
  const ready = status === 'ready' && Excalidraw && initialData !== null

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {!ready && (
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          <span className="text-xs text-muted-foreground">Loading canvas…</span>
        </div>
      )}
      {ready && (
        <div className="flex-1 min-h-0">
          <Excalidraw
            initialData={initialData}
            theme={theme}
            name={fileName}
            onChange={handleChange}
            excalidrawAPI={(api) => {
              apiRef.current = api
              api.onPointerDown(() => {
                pointerDownRef.current = true
                lastInteractionRef.current = Date.now()
              })
              api.onPointerUp(() => {
                pointerDownRef.current = false
                lastInteractionRef.current = Date.now()
              })
            }}
          />
        </div>
      )}
    </div>
  )
}

export default CanvasViewer
