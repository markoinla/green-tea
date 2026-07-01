import { useState, useEffect, useCallback } from 'react'
import type { RegistryListItem } from '../../../shared/share-contract'

/**
 * Community-registry hooks (marketplace layer two, Phases 4/5).
 *
 * - `useRegistryStatus` — which installed items are registry-sourced (from the
 *   on-disk provenance markers) plus a PASSIVE update check that runs once per
 *   mount of the hosting panel (no polling, no startup check).
 * - `useCommunitySearch` — debounced server-side search of the community
 *   registry, scoped to a type, active only while the hosting dialog is open.
 * - `useCommunityInstall` — install/update flow with the blocking
 *   permission-consent step for items whose manifest declares permissions.
 */

export interface RegistryInstallRef {
  itemId: string
  /** 'skill' | 'plugin' — consumers must match provenance on type + slug, not slug alone. */
  type: 'skill' | 'plugin'
  version: string
}

export interface RegistryUpdateRef {
  itemId: string
  installedVersion: string
  latestVersion: string
}

/** Registry item id `<handle>/<slug>` → on-disk/local id `<handle>--<slug>`. */
export function registryLocalId(itemId: string): string {
  return itemId.replace('/', '--')
}

/** The slug half of a registry item id (a registry skill's local NAME equals its slug). */
export function registrySlug(itemId: string): string {
  const slash = itemId.indexOf('/')
  return slash >= 0 ? itemId.slice(slash + 1) : itemId
}

export function useRegistryStatus() {
  const [installs, setInstalls] = useState<RegistryInstallRef[]>([])
  const [updates, setUpdates] = useState<RegistryUpdateRef[]>([])

  const refreshInstalls = useCallback(async () => {
    try {
      setInstalls(await window.api.registry.installs())
    } catch {
      setInstalls([])
    }
  }, [])

  useEffect(() => {
    refreshInstalls()
    const unsubPlugins = window.api.onPluginsChanged(refreshInstalls)
    const unsubSkills = window.api.onSkillsChanged(refreshInstalls)
    return () => {
      unsubPlugins()
      unsubSkills()
    }
  }, [refreshInstalls])

  // Passive update check: exactly once per mount (i.e. when the panel opens).
  // Failures are silent — update badges are best-effort decoration.
  useEffect(() => {
    let cancelled = false
    window.api.registry
      .checkUpdates()
      .then((result) => {
        if (!cancelled) setUpdates(result)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Drop updates that no longer apply (e.g. the user just updated — the
  // provenance marker's version moved past the one the check saw).
  const pendingUpdates = updates.filter((u) => {
    const current = installs.find((i) => i.itemId === u.itemId)
    return current !== undefined && current.version === u.installedVersion
  })

  return { installs, updates: pendingUpdates, refreshInstalls }
}

export function useCommunitySearch(type: 'skill' | 'plugin', open: boolean) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<RegistryListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const q = query.trim()
    const timer = setTimeout(
      async () => {
        try {
          const results = await window.api.registry.search({
            q: q || undefined,
            type,
            sort: 'installs'
          })
          if (!cancelled) {
            setItems(results)
            setError(null)
          }
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err))
        } finally {
          if (!cancelled) setLoading(false)
        }
      },
      q ? 300 : 0
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query, type, nonce])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  return { query, setQuery, items, loading, error, refresh }
}

/** A pending blocking-consent request (registry item declaring permissions). */
export interface ConsentRequest {
  itemId: string
  name: string
  permissions: string[]
}

export function useCommunityInstall() {
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState<ConsentRequest | null>(null)

  const doInstall = useCallback(async (itemId: string) => {
    setInstalling(itemId)
    setError(null)
    try {
      await window.api.registry.install(itemId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
    }
  }, [])

  /**
   * Install (or update) a registry item. If its server-validated manifest
   * declares any permissions, a blocking consent request is surfaced instead
   * and nothing is written until `confirmConsent`.
   */
  const requestInstall = useCallback(
    async (item: { id: string; name: string }) => {
      setError(null)
      setInstalling(item.id)
      let permissions: string[] = []
      try {
        const { manifest } = await window.api.registry.manifest(item.id)
        const declared = (manifest as { permissions?: unknown }).permissions
        if (Array.isArray(declared)) {
          permissions = declared.filter((p): p is string => typeof p === 'string' && p.length > 0)
        }
      } catch (err) {
        setInstalling(null)
        setError(err instanceof Error ? err.message : String(err))
        return
      }
      if (permissions.length > 0) {
        setInstalling(null)
        setConsent({ itemId: item.id, name: item.name, permissions })
        return
      }
      await doInstall(item.id)
    },
    [doInstall]
  )

  const confirmConsent = useCallback(async () => {
    const request = consent
    setConsent(null)
    if (request) await doInstall(request.itemId)
  }, [consent, doInstall])

  const cancelConsent = useCallback(() => setConsent(null), [])

  return { installing, error, consent, requestInstall, confirmConsent, cancelConsent }
}
