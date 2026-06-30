import { useState } from 'react'
import { ChevronLeft, Trash2, Store } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { usePlugins } from '@renderer/hooks/usePlugins'
import { PluginMarketplaceDialog } from './PluginMarketplaceDialog'

export function PluginsTab() {
  const {
    plugins,
    installing,
    error: pluginsError,
    installPlugin,
    removePlugin,
    togglePlugin
  } = usePlugins()
  const [pluginUrl, setPluginUrl] = useState('')
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null)
  const [pluginToDelete, setPluginToDelete] = useState<string | null>(null)
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Plugins</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Install and manage artifact plugins from GitHub.
        </p>
      </div>
      <PluginMarketplaceDialog open={marketplaceOpen} onOpenChange={setMarketplaceOpen} />
      <ConfirmDeleteDialog
        open={!!pluginToDelete}
        onOpenChange={(open) => !open && setPluginToDelete(null)}
        title="Delete plugin"
        itemName={pluginToDelete}
        description="Are you sure you want to delete"
        onConfirm={() => {
          if (pluginToDelete) {
            removePlugin(pluginToDelete)
            if (selectedPlugin === pluginToDelete) setSelectedPlugin(null)
          }
          setPluginToDelete(null)
        }}
      />
      {selectedPlugin && plugins.find((p) => p.id === selectedPlugin) ? (
        (() => {
          const plugin = plugins.find((p) => p.id === selectedPlugin)!
          return (
            <div className="space-y-4">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedPlugin(null)}
              >
                <ChevronLeft className="size-4" />
                Back
              </button>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-medium">{plugin.name}</h3>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={plugin.enabled}
                        onCheckedChange={(v) => togglePlugin(plugin.id, v)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {plugin.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-500"
                      onClick={() => setPluginToDelete(plugin.id)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                {plugin.description && (
                  <p className="text-sm text-muted-foreground">{plugin.description}</p>
                )}
                {plugin.bundlesSkills && (
                  <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/50 px-3 py-2">
                    This plugin adds agent skills — instructions that guide the AI agent when
                    working with its files. They run with the existing sandboxed agent tools and are
                    enabled and removed together with the plugin.
                  </p>
                )}
              </div>
            </div>
          )
        })()
      ) : (
        <>
          <button
            type="button"
            className="w-full h-9 rounded-lg border border-border bg-muted text-sm text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-2"
            onClick={() => setMarketplaceOpen(true)}
          >
            <Store className="size-4" />
            Browse Marketplace
          </button>
          <p className="text-xs text-muted-foreground">
            Add artifact plugins from GitHub. Paste a URL like
            https://github.com/owner/repo/tree/branch/plugins/name
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3"
              placeholder="https://github.com/..."
              value={pluginUrl}
              onChange={(e) => setPluginUrl(e.target.value)}
              disabled={!!installing}
            />
            <button
              type="button"
              className="h-9 rounded-lg bg-accent text-accent-foreground px-3 text-sm disabled:opacity-50"
              disabled={!!installing || !pluginUrl.trim()}
              onClick={async () => {
                await installPlugin(pluginUrl.trim())
                setPluginUrl('')
              }}
            >
              {installing ? 'Installing...' : 'Add'}
            </button>
          </div>
          {pluginsError && <p className="text-xs text-red-500">{pluginsError}</p>}
          {plugins.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {plugins.map((plugin) => (
                <button
                  key={plugin.id}
                  type="button"
                  className={`rounded-lg border border-border bg-muted p-3 text-left hover:border-foreground/20 transition-colors ${!plugin.enabled ? 'opacity-60' : ''}`}
                  onClick={() => setSelectedPlugin(plugin.id)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-1.5 rounded-full shrink-0 ${plugin.enabled ? 'bg-green-500' : 'bg-foreground/20'}`}
                    />
                    <p className="text-sm font-medium truncate">{plugin.name}</p>
                    {plugin.bundlesSkills && (
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                        +skills
                      </span>
                    )}
                  </div>
                  {plugin.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                      {plugin.description}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
          {plugins.length === 0 && !pluginsError && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No plugins installed yet.
            </p>
          )}
        </>
      )}
    </div>
  )
}
