import { useState, useCallback } from 'react'

interface UseSidebarDragAndDropOptions {
  updateDocument: (id: string, data: { folder_id: string | null }) => Promise<unknown>
}

export function useSidebarDragAndDrop({ updateDocument }: UseSidebarDragAndDropOptions) {
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [dragOverRoot, setDragOverRoot] = useState(false)

  const handleDragStart = useCallback((e: React.DragEvent, docId: string) => {
    e.dataTransfer.setData('text/plain', docId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDropOnFolder = useCallback(
    async (e: React.DragEvent, folderId: string) => {
      if (e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragOverFolderId(null)
      const docId = e.dataTransfer.getData('text/plain')
      if (docId) {
        await updateDocument(docId, { folder_id: folderId })
      }
    },
    [updateDocument]
  )

  const handleDropOnRoot = useCallback(
    async (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragOverRoot(false)
      const docId = e.dataTransfer.getData('text/plain')
      if (docId) {
        await updateDocument(docId, { folder_id: null })
      }
    },
    [updateDocument]
  )

  const handleDragOverFolder = useCallback((e: React.DragEvent, folderId: string) => {
    if (e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverFolderId(folderId)
  }, [])

  const handleDragOverRoot = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverRoot(true)
  }, [])

  const handleDragLeaveFolder = useCallback(() => {
    setDragOverFolderId(null)
  }, [])

  const handleDragLeaveRoot = useCallback(() => {
    setDragOverRoot(false)
  }, [])

  return {
    dragOverFolderId,
    dragOverRoot,
    handleDragStart,
    handleDropOnFolder,
    handleDropOnRoot,
    handleDragOverFolder,
    handleDragOverRoot,
    handleDragLeaveFolder,
    handleDragLeaveRoot
  }
}
