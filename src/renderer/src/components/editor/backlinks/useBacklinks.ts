import { useCallback, useEffect, useState } from 'react'
import type { Backlink } from '../../../../../main/vault/documents-service'

/**
 * Loads the notes that link to `documentId` via a [[wiki-link]] and refetches
 * whenever any document changes (a link may have been added elsewhere). Returns
 * an empty array on failure — the right fallback for an empty panel/pill.
 */
export function useBacklinks(documentId: string): Backlink[] {
  const [backlinks, setBacklinks] = useState<Backlink[]>([])

  const load = useCallback(async () => {
    try {
      const result = (await window.api.documents.backlinks(documentId)) as Backlink[]
      setBacklinks(result)
    } catch {
      setBacklinks([])
    }
  }, [documentId])

  useEffect(() => {
    load()
    const off = window.api.onDocumentsChanged(load)
    return off
  }, [load])

  return backlinks
}
