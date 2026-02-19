import { useState, useEffect, useCallback } from 'react'

interface MarketplaceSkill {
  name: string
  description: string
  author: string
  version: string
  path: string
}

export function useMarketplace() {
  const [registry, setRegistry] = useState<MarketplaceSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRegistry = useCallback(async (force?: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const data = force
        ? await window.api.skills.marketplaceRefresh()
        : await window.api.skills.marketplaceList()
      setRegistry(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRegistry()
  }, [fetchRegistry])

  const refresh = useCallback(() => fetchRegistry(true), [fetchRegistry])

  return { registry, loading, error, refresh }
}
