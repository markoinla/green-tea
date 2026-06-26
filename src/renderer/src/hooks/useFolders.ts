import { useState, useEffect, useRef, useCallback } from 'react'
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
  // Guards against a stale list() resolving after a workspace switch.
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId
  // Show loading only on first load / workspace switch; background refreshes keep
  // the current list on screen (stale-while-revalidate) so toggles don't flash.
  const loadedWsRef = useRef<string | null | undefined>(undefined)

  const refresh = useCallback(async () => {
    const reqWs = workspaceId
    if (loadedWsRef.current !== reqWs) setLoading(true)
    try {
      const result = await window.api.folders.list(reqWs ?? undefined)
      if (workspaceIdRef.current !== reqWs) return
      setFolders(result)
      loadedWsRef.current = reqWs
    } finally {
      if (workspaceIdRef.current === reqWs) setLoading(false)
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
      // Optimistically apply a collapse toggle so the disclosure animates the
      // instant the user clicks, rather than after the IPC + DB write resolves.
      if (data.collapsed !== undefined) {
        const next = data.collapsed
        setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, collapsed: next } : f)))
      }
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
