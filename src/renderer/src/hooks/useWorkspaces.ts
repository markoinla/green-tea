import { useState, useEffect, useCallback } from 'react'
import type { Workspace } from '../../../main/database/types'

interface UseWorkspacesResult {
  workspaces: Workspace[]
  loading: boolean
  createWorkspace: (data: { name: string }) => Promise<Workspace>
  updateWorkspace: (id: string, data: { name?: string; description?: string }) => Promise<Workspace>
  deleteWorkspace: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

export function useWorkspaces(): UseWorkspacesResult {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.workspaces.list()
      setWorkspaces(result)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const unsub = window.api.onWorkspacesChanged(() => {
      refresh()
    })
    return unsub
  }, [refresh])

  const createWorkspace = useCallback(
    async (data: { name: string }) => {
      const workspace = await window.api.workspaces.create(data)
      await refresh()
      return workspace
    },
    [refresh]
  )

  const updateWorkspace = useCallback(
    async (id: string, data: { name?: string; description?: string }) => {
      const workspace = await window.api.workspaces.update(id, data)
      await refresh()
      return workspace
    },
    [refresh]
  )

  const deleteWorkspace = useCallback(
    async (id: string) => {
      await window.api.workspaces.delete(id)
      await refresh()
    },
    [refresh]
  )

  return { workspaces, loading, createWorkspace, updateWorkspace, deleteWorkspace, refresh }
}
