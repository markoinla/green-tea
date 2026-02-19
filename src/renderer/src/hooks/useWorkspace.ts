import { useState, useEffect, useCallback } from 'react'
import type { Workspace } from '../../../main/database/types'

interface UseWorkspaceResult {
  workspace: Workspace | null
  loading: boolean
  refresh: () => Promise<void>
}

export function useWorkspace(id: string | null): UseWorkspaceResult {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!id) {
      setWorkspace(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await window.api.workspaces.get(id)
      setWorkspace(result ?? null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    refresh()
    const unsub = window.api.onWorkspacesChanged(() => {
      refresh()
    })
    return unsub
  }, [refresh])

  return { workspace, loading, refresh }
}
