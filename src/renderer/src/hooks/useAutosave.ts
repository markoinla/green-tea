import { useEffect, useRef, useCallback } from 'react'
import type { JSONContent } from '@tiptap/react'

const DEBOUNCE_MS = 500

/**
 * Tracks whether a documents:content-changed event was triggered by the
 * local autosave. Checked by useDocument to avoid remounting the editor
 * after our own saves.
 */
let localSaveInFlight = false
const LOCAL_SAVE_WINDOW_MS = 1000

export function isLocalSave(): boolean {
  return localSaveInFlight
}

export function useAutosave(documentId: string) {
  const pendingRef = useRef<JSONContent | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (pendingRef.current) {
      const content = JSON.stringify(pendingRef.current)
      pendingRef.current = null
      localSaveInFlight = true
      window.api.documents
        .update(documentId, { content })
        .catch((err) => {
          console.error('[autosave] failed to save document', documentId, err)
        })
        .finally(() => {
          setTimeout(() => {
            localSaveInFlight = false
          }, LOCAL_SAVE_WINDOW_MS)
        })
    }
  }, [documentId])

  const save = useCallback(
    (content: JSONContent) => {
      pendingRef.current = content
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(flush, DEBOUNCE_MS)
    },
    [flush]
  )

  // Flush on unmount (note switch, app close)
  useEffect(() => {
    return flush
  }, [flush])

  return save
}
