import { useState, useEffect, useCallback } from 'react'

interface PluginInfo {
  id: string
  name: string
  description: string
  version: string
  author?: string
  enabled: boolean
  /** Whether the plugin ships bundled agent skills (`contributes.skills`). */
  bundlesSkills: boolean
}

interface MarketplacePlugin {
  id: string
  name: string
  description: string
  author: string
  version: string
  path: string
}

export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchPlugins = useCallback(async () => {
    const list = await window.api.plugins.list()
    setPlugins(
      list.map((p) => ({
        id: p.id,
        name: p.name ?? p.manifest?.name ?? p.id,
        description: p.description ?? p.manifest?.description ?? '',
        version: p.version ?? p.manifest?.version ?? '',
        author: p.author ?? p.manifest?.author,
        enabled: p.enabled,
        bundlesSkills:
          Array.isArray(p.manifest?.contributes?.skills) && p.manifest.contributes.skills.length > 0
      }))
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchPlugins()
    const unsub = window.api.onPluginsChanged(fetchPlugins)
    return unsub
  }, [fetchPlugins])

  const installPlugin = useCallback(async (url: string) => {
    setInstalling(url)
    setError(null)
    try {
      await window.api.plugins.install(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
    }
  }, [])

  const removePlugin = useCallback(async (id: string) => {
    setError(null)
    try {
      await window.api.plugins.remove(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const togglePlugin = useCallback(async (id: string, enabled: boolean) => {
    setError(null)
    try {
      await window.api.plugins.toggle(id, enabled)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  return { plugins, loading, installing, error, installPlugin, removePlugin, togglePlugin }
}

export function usePluginMarketplace() {
  const [registry, setRegistry] = useState<MarketplacePlugin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRegistry = useCallback(async (force?: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const data = force
        ? await window.api.plugins.marketplaceRefresh()
        : await window.api.plugins.marketplaceList()
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
