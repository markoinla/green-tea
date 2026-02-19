import { useState, useEffect, useCallback } from 'react'
import type { Block, BlockNode } from '../../../main/database/types'

interface UseBlocksResult {
  blocks: BlockNode[]
  loading: boolean
  createBlock: (data: {
    document_id: string
    parent_block_id?: string
    type?: string
    content?: string
    position?: number
  }) => Promise<Block>
  updateBlock: (
    id: string,
    data: { type?: string; content?: string; collapsed?: number; position?: number }
  ) => Promise<Block>
  deleteBlock: (id: string) => Promise<void>
  moveBlock: (id: string, data: { parent_block_id?: string; position: number }) => Promise<void>
  refresh: () => Promise<void>
}

export function useBlocks(documentId: string | null): UseBlocksResult {
  const [blocks, setBlocks] = useState<BlockNode[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!documentId) {
      setBlocks([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const tree = await window.api.blocks.getTree(documentId)
      setBlocks(tree)
    } finally {
      setLoading(false)
    }
  }, [documentId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createBlock = useCallback(
    async (data: {
      document_id: string
      parent_block_id?: string
      type?: string
      content?: string
      position?: number
    }) => {
      const block = await window.api.blocks.create(data)
      await refresh()
      return block
    },
    [refresh]
  )

  const updateBlock = useCallback(
    async (
      id: string,
      data: { type?: string; content?: string; collapsed?: number; position?: number }
    ) => {
      const block = await window.api.blocks.update(id, data)
      await refresh()
      return block
    },
    [refresh]
  )

  const deleteBlock = useCallback(
    async (id: string) => {
      await window.api.blocks.delete(id)
      await refresh()
    },
    [refresh]
  )

  const moveBlock = useCallback(
    async (id: string, data: { parent_block_id?: string; position: number }) => {
      await window.api.blocks.move(id, data)
      await refresh()
    },
    [refresh]
  )

  return { blocks, loading, createBlock, updateBlock, deleteBlock, moveBlock, refresh }
}
