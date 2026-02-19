import { useState, useEffect, useCallback } from 'react'
import type { WorkspaceFile } from '../../../main/database/types'

interface UseWorkspaceFilesResult {
  files: WorkspaceFile[]
  loading: boolean
  addFiles: (filePaths: string[]) => Promise<void>
  pickAndAddFiles: () => Promise<void>
  pickAndAddFolder: () => Promise<void>
  removeFile: (id: string) => Promise<void>
}

export function useWorkspaceFiles(workspaceId?: string | null): UseWorkspaceFilesResult {
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setFiles([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await window.api.workspaceFiles.list(workspaceId)
      setFiles(result)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    refresh()
    const unsub = window.api.onWorkspaceFilesChanged(() => {
      refresh()
    })
    return unsub
  }, [refresh])

  const addFiles = useCallback(
    async (filePaths: string[]) => {
      if (!workspaceId) return
      const resolvedPaths = await window.api.workspaceFiles.resolvePaths(filePaths)
      for (const filePath of resolvedPaths) {
        const fileName = filePath.split('/').pop() || filePath
        try {
          await window.api.workspaceFiles.add({
            workspace_id: workspaceId,
            file_path: filePath,
            file_name: fileName
          })
        } catch {
          // Skip duplicates silently
        }
      }
      await refresh()
    },
    [workspaceId, refresh]
  )

  const pickAndAddFiles = useCallback(async () => {
    const paths = await window.api.workspaceFiles.pick()
    if (paths.length > 0) {
      await addFiles(paths)
    }
  }, [addFiles])

  const removeFile = useCallback(
    async (id: string) => {
      await window.api.workspaceFiles.remove(id)
      await refresh()
    },
    [refresh]
  )

  const pickAndAddFolder = useCallback(async () => {
    const folderPath = await window.api.dialog.pickFolder()
    if (folderPath) {
      await addFiles([folderPath])
    }
  }, [addFiles])

  return { files, loading, addFiles, pickAndAddFiles, pickAndAddFolder, removeFile }
}
