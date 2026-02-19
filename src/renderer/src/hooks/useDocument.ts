import { useState, useEffect, useRef } from 'react'
import type { JSONContent } from '@tiptap/react'
import type { Document } from '../../../main/database/types'
import { isLocalSave } from './useAutosave'

interface UseDocumentResult {
  document: Document | null
  loading: boolean
  /** Incremented each time external (non-local) content arrives. */
  externalContentVersion: number
  /** Parsed JSON content from the latest external update, or null. */
  externalContent: JSONContent | null
}

export function useDocument(id: string | null): UseDocumentResult {
  const [document, setDocument] = useState<Document | null>(null)
  const [loading, setLoading] = useState(id !== null)
  const [externalContentVersion, setExternalContentVersion] = useState(0)
  const externalContentRef = useRef<JSONContent | null>(null)

  useEffect(() => {
    if (!id) {
      setDocument(null)
      return
    }

    setLoading(true)
    window.api.documents.get(id).then((doc) => {
      setDocument(doc ?? null)
      setLoading(false)
    })

    // Content-only changes (autosaves, agent patches).
    // Skip our own autosaves to avoid re-syncing.
    const unsubContent = window.api.onDocumentContentChanged((data) => {
      if (data.id !== id) return
      if (isLocalSave()) return
      window.api.documents.get(id).then((doc) => {
        setDocument(doc ?? null)
        // Parse the new content for in-place editor update (no remount).
        try {
          externalContentRef.current = doc?.content ? JSON.parse(doc.content) : null
        } catch {
          externalContentRef.current = null
        }
        setExternalContentVersion((v) => v + 1)
      })
    })

    // Structural changes (title, folder, workspace) — refresh metadata
    // but don't bump version (no editor remount needed).
    const unsubStructural = window.api.onDocumentsChanged(() => {
      window.api.documents.get(id).then((doc) => {
        setDocument(doc ?? null)
      })
    })

    return () => {
      unsubContent()
      unsubStructural()
    }
  }, [id])

  return {
    document,
    loading,
    externalContentVersion,
    externalContent: externalContentRef.current
  }
}
