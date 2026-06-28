import { useCallback, useEffect, useState } from 'react'
import type { OutgoingLink } from '../../../../../main/vault/documents-service'

/**
 * Loads the notes that `documentId` links to via a [[wiki-link]] and refetches
 * whenever any document changes (a link may have been added/removed here, or a
 * target note created/renamed, which flips a broken link to resolved). Returns
 * an empty array on failure — the right fallback for an empty panel/count.
 */
export function useOutgoingLinks(documentId: string): OutgoingLink[] {
  const [links, setLinks] = useState<OutgoingLink[]>([])

  const load = useCallback(async () => {
    try {
      const result = (await window.api.documents.outgoingLinks(documentId)) as OutgoingLink[]
      setLinks(result)
    } catch {
      setLinks([])
    }
  }, [documentId])

  useEffect(() => {
    load()
    const off = window.api.onDocumentsChanged(load)
    return off
  }, [load])

  return links
}
