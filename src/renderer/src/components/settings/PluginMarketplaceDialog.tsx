import { useMemo, useState } from 'react'
import { RefreshCw, Check, Loader2, Download, Search, ArrowUpCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@renderer/components/ui/dialog'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { usePlugins, usePluginMarketplace } from '@renderer/hooks/usePlugins'
import {
  registryLocalId,
  useCommunityInstall,
  useCommunitySearch,
  useRegistryStatus
} from '@renderer/hooks/useRegistry'
import { RegistryConsentDialog } from './RegistryConsentDialog'

interface PluginMarketplaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function SourceBadge({ source }: { source: 'official' | 'community' }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border shrink-0 ${
        source === 'official'
          ? 'bg-accent/10 text-accent border-accent/30'
          : 'bg-muted text-muted-foreground border-border'
      }`}
    >
      {source}
    </span>
  )
}

export function PluginMarketplaceDialog({ open, onOpenChange }: PluginMarketplaceDialogProps) {
  const { registry, loading, error, refresh } = usePluginMarketplace()
  const { plugins, installing, error: installError, installPlugin } = usePlugins()
  const { installs, updates } = useRegistryStatus()
  const community = useCommunitySearch('plugin', open)
  const communityInstall = useCommunityInstall()
  const [query, setQuery] = useState('')

  const installedIds = new Set(plugins.map((p) => p.id))
  // Only PLUGIN provenance counts here (type + slug matching, not slug alone).
  const installedItemIds = new Set(installs.filter((i) => i.type === 'plugin').map((i) => i.itemId))
  const updatableItemIds = new Set(updates.map((u) => u.itemId))

  function pluginUrl(path: string): string {
    return `https://github.com/markoinla/green-tea/tree/main/${path}`
  }

  // Official entries are filtered client-side; community entries are
  // re-queried server-side from the same search box.
  const officialFiltered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return registry
    return registry.filter(
      (entry) => entry.name.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q)
    )
  }, [registry, query])

  function setSearch(value: string) {
    setQuery(value)
    community.setQuery(value)
  }

  const anyLoading = loading || community.loading
  const busy = !!installing || !!communityInstall.installing

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Plugin Marketplace</DialogTitle>
              <DialogDescription>
                Browse and install official and community plugins for your workspace.
              </DialogDescription>
            </div>
            <button
              type="button"
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={() => {
                refresh()
                community.refresh()
              }}
              disabled={anyLoading}
            >
              <RefreshCw className={`size-4 ${anyLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </DialogHeader>

        <RegistryConsentDialog
          request={communityInstall.consent}
          onAllow={() => void communityInstall.confirmConsent()}
          onCancel={communityInstall.cancelConsent}
        />

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            className="w-full h-9 rounded-lg border border-border bg-background text-foreground text-sm pl-9 pr-3"
            placeholder="Search plugins..."
            value={query}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {anyLoading && registry.length === 0 && community.items.length === 0 && (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border p-4 space-y-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-8 w-20 mt-2" />
              </div>
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="text-center py-4 space-y-3">
            <p className="text-sm text-red-500">{error}</p>
            <button
              type="button"
              className="h-8 rounded-lg bg-muted text-muted-foreground px-3 text-xs hover:text-foreground"
              onClick={refresh}
            >
              Retry
            </button>
          </div>
        )}
        {community.error && !community.loading && (
          <p className="text-xs text-muted-foreground text-center">
            Community plugins unavailable: {community.error}
          </p>
        )}

        {installError && <p className="text-sm text-red-500">{installError}</p>}
        {communityInstall.error && <p className="text-sm text-red-500">{communityInstall.error}</p>}

        {!anyLoading && officialFiltered.length === 0 && community.items.length === 0 && !error && (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              {query ? 'No plugins match your search.' : 'No plugins available yet.'}
            </p>
          </div>
        )}

        {(officialFiltered.length > 0 || community.items.length > 0) && (
          <div className="grid grid-cols-3 gap-3">
            {!loading &&
              officialFiltered.map((entry) => {
                const isInstalled = installedIds.has(entry.id)
                const isInstalling = installing === pluginUrl(entry.path)
                return (
                  <div
                    key={`official:${entry.id}`}
                    className="rounded-lg border border-border p-4 flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{entry.name}</p>
                      <SourceBadge source="official" />
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {entry.description}
                    </p>
                    <p className="text-xs text-muted-foreground">by {entry.author}</p>
                    <div className="mt-auto pt-2">
                      {isInstalled ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <Check className="size-3.5" />
                          Installed
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent text-accent-foreground px-3 text-xs disabled:opacity-50"
                          disabled={busy}
                          onClick={() => installPlugin(pluginUrl(entry.path))}
                        >
                          {isInstalling ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Download className="size-3.5" />
                          )}
                          Install
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            {!community.loading &&
              community.items.map((item) => {
                const isInstalled =
                  installedItemIds.has(item.id) || installedIds.has(registryLocalId(item.id))
                const hasUpdate = updatableItemIds.has(item.id)
                const isInstalling = communityInstall.installing === item.id
                return (
                  <div
                    key={`community:${item.id}`}
                    className="rounded-lg border border-border p-4 flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <SourceBadge source="community" />
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                    <p className="text-xs text-muted-foreground">
                      by @{item.handle} · v{item.latestVersion} · {item.installCount} installs
                    </p>
                    <div className="mt-auto pt-2">
                      {isInstalled && hasUpdate ? (
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent text-accent-foreground px-3 text-xs disabled:opacity-50"
                          disabled={busy}
                          onClick={() => void communityInstall.requestInstall(item)}
                        >
                          {isInstalling ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <ArrowUpCircle className="size-3.5" />
                          )}
                          Update
                        </button>
                      ) : isInstalled ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          <Check className="size-3.5" />
                          Installed
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent text-accent-foreground px-3 text-xs disabled:opacity-50"
                          disabled={busy}
                          onClick={() => void communityInstall.requestInstall(item)}
                        >
                          {isInstalling ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Download className="size-3.5" />
                          )}
                          Install
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
