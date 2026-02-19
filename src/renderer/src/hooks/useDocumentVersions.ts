import { useState, useEffect, useCallback } from 'react'
import type { DocumentVersion } from '../../../main/database/types'

interface UseDocumentVersionsResult {
  versions: DocumentVersion[]
  loading: boolean
  createManualVersion: () => Promise<void>
  restoreVersion: (id: string) => Promise<void>
  deleteVersion: (id: string) => Promise<void>
}

export function useDocumentVersions(documentId: string | null): UseDocumentVersionsResult {
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [loading, setLoading] = useState(false)

  const fetchVersions = useCallback(() => {
    if (!documentId) {
      setVersions([])
      return
    }
    setLoading(true)
    window.api.documentVersions.list(documentId).then((result) => {
      setVersions(result as DocumentVersion[])
      setLoading(false)
    })
  }, [documentId])

  useEffect(() => {
    fetchVersions()
    const unsub = window.api.onDocumentVersionsChanged(() => {
      fetchVersions()
    })
    return unsub
  }, [fetchVersions])

  const createManualVersion = useCallback(async () => {
    if (!documentId) return
    const doc = (await window.api.documents.get(documentId)) as {
      title: string
      content: string | null
    } | null
    if (!doc) return
    await window.api.documentVersions.create({
      document_id: documentId,
      title: doc.title,
      content: doc.content
    })
  }, [documentId])

  const restoreVersion = useCallback(
    async (id: string) => {
      if (!documentId) return
      await window.api.documentVersions.restore(id)
    },
    [documentId]
  )

  const deleteVersion = useCallback(async (id: string) => {
    await window.api.documentVersions.delete(id)
  }, [])

  return { versions, loading, createManualVersion, restoreVersion, deleteVersion }
}
