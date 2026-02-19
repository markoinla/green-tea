import { RefreshCw, Check, Loader2, Download } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@renderer/components/ui/dialog'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { useMarketplace } from '@renderer/hooks/useMarketplace'
import { useSkills } from '@renderer/hooks/useSkills'

interface MarketplaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MarketplaceDialog({ open, onOpenChange }: MarketplaceDialogProps) {
  const { registry, loading, error, refresh } = useMarketplace()
  const { skills, installing, error: installError, installSkill } = useSkills()

  const installedNames = new Set(skills.map((s) => s.name))

  function skillUrl(path: string): string {
    return `https://github.com/markoinla/green-tea/tree/main/${path}`
  }

  function handleInstall(path: string) {
    installSkill(skillUrl(path))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Skill Marketplace</DialogTitle>
              <DialogDescription>Browse and install skills for your agent.</DialogDescription>
            </div>
            <button
              type="button"
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </DialogHeader>

        {loading && (
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
          <div className="text-center py-8 space-y-3">
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

        {!loading && !error && registry.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No skills available yet.</p>
          </div>
        )}

        {installError && <p className="text-sm text-red-500">{installError}</p>}

        {!loading && !error && registry.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {registry.map((entry) => {
              const isInstalled = installedNames.has(entry.name)
              const isInstalling = installing === skillUrl(entry.path)
              return (
                <div
                  key={entry.name}
                  className="rounded-lg border border-border p-4 flex flex-col gap-2"
                >
                  <p className="text-sm font-medium">{entry.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{entry.description}</p>
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
                        disabled={!!installing}
                        onClick={() => handleInstall(entry.path)}
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
