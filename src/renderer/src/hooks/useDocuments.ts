import { useState, useEffect, useCallback } from 'react'
import type { Document } from '../../../main/database/types'

interface UseDocumentsResult {
  documents: Document[]
  loading: boolean
  createDocument: (data: {
    title: string
    workspace_id?: string
    folder_id?: string | null
  }) => Promise<Document>
  updateDocument: (
    id: string,
    data: {
      title?: string
      workspace_id?: string
      content?: string
      folder_id?: string | null
    }
  ) => Promise<Document>
  deleteDocument: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

export function useDocuments(workspaceId?: string | null): UseDocumentsResult {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const docs = await window.api.documents.list(workspaceId ?? undefined)
      setDocuments(docs)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    refresh()
    const unsub = window.api.onDocumentsChanged(() => {
      refresh()
    })
    return unsub
  }, [refresh])

  const createDocument = useCallback(
    async (data: { title: string; workspace_id?: string; folder_id?: string | null }) => {
      const doc = await window.api.documents.create({
        ...data,
        workspace_id: data.workspace_id ?? workspaceId ?? undefined
      })
      await refresh()
      return doc
    },
    [refresh, workspaceId]
  )

  const updateDocument = useCallback(
    async (
      id: string,
      data: { title?: string; workspace_id?: string; content?: string; folder_id?: string | null }
    ) => {
      const doc = await window.api.documents.update(id, data)
      await refresh()
      return doc
    },
    [refresh]
  )

  const deleteDocument = useCallback(
    async (id: string) => {
      await window.api.documents.delete(id)
      await refresh()
    },
    [refresh]
  )

  return { documents, loading, createDocument, updateDocument, deleteDocument, refresh }
}
