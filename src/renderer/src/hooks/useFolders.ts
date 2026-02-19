import { useState, useEffect, useCallback } from 'react'
import type { Folder } from '../../../main/database/types'

interface UseFoldersResult {
  folders: Folder[]
  loading: boolean
  createFolder: (data: { name: string }) => Promise<Folder>
  updateFolder: (id: string, data: { name?: string; collapsed?: number }) => Promise<Folder>
  deleteFolder: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

export function useFolders(workspaceId?: string | null): UseFoldersResult {
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.folders.list(workspaceId ?? undefined)
      setFolders(result)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    refresh()
    const unsub = window.api.onFoldersChanged(() => {
      refresh()
    })
    return unsub
  }, [refresh])

  const createFolder = useCallback(
    async (data: { name: string }) => {
      const folder = await window.api.folders.create({
        ...data,
        workspace_id: workspaceId ?? undefined
      })
      await refresh()
      return folder
    },
    [refresh, workspaceId]
  )

  const updateFolder = useCallback(
    async (id: string, data: { name?: string; collapsed?: number }) => {
      const folder = await window.api.folders.update(id, data)
      await refresh()
      return folder
    },
    [refresh]
  )

  const deleteFolder = useCallback(
    async (id: string) => {
      await window.api.folders.delete(id)
      await refresh()
    },
    [refresh]
  )

  return { folders, loading, createFolder, updateFolder, deleteFolder, refresh }
}
