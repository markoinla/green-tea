import { useState, useEffect, useCallback } from 'react'
import { Share2, Copy, Link2Off, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@renderer/components/ui/dropdown-menu'
import { cn } from '@renderer/lib/utils'

interface ShareState {
  shared: boolean
  url?: string
  slug?: string
  expiresAt?: string
}

/** Days remaining (rounded up); negative once past the expiry instant. */
const MS_PER_DAY = 24 * 60 * 60 * 1000
const EXPIRING_SOON_DAYS = 7

interface ExpiryInfo {
  expired: boolean
  /** True when not yet expired but within the warning window. */
  soon: boolean
  /** Human label, e.g. "Expires in 23 days" or "Link expired". */
  label: string
  /** Tailwind text-color class reflecting urgency. */
  tone: string
}

function describeExpiry(expiresAt: string | undefined): ExpiryInfo | null {
  if (!expiresAt) return null
  const ms = Date.parse(expiresAt)
  if (Number.isNaN(ms)) return null
  const days = Math.ceil((ms - Date.now()) / MS_PER_DAY)
  if (days <= 0) {
    return { expired: true, soon: false, label: 'Link expired', tone: 'text-destructive' }
  }
  const unit = days === 1 ? 'day' : 'days'
  const soon = days <= EXPIRING_SOON_DAYS
  return {
    expired: false,
    soon,
    label: `Expires in ${days} ${unit}`,
    tone: soon ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'
  }
}

/**
 * Share affordance for the unified document header (covers both notes and `html`
 * artifacts, since AppLayout's header renders for the active tab regardless of
 * kind). Fetches publish status on doc change; offers Create-link / Copy /
 * Unshare. `publish`/`unpublish` reject on failure, so every call is guarded and
 * surfaces the error message via toast (e.g. "Share publish token not configured").
 */
export function ShareControl({ docId, canShare }: { docId: string | null; canShare: boolean }) {
  const [state, setState] = useState<ShareState>({ shared: false })
  const [busy, setBusy] = useState(false)

  // Refresh share status whenever the active document changes.
  useEffect(() => {
    if (!docId || !canShare) {
      setState({ shared: false })
      return
    }
    let cancelled = false
    window.api.share
      .status(docId)
      .then((s) => {
        if (!cancelled) setState(s)
      })
      .catch(() => {
        if (!cancelled) setState({ shared: false })
      })
    return () => {
      cancelled = true
    }
  }, [docId, canShare])

  const handlePublish = useCallback(async () => {
    if (!docId) return
    setBusy(true)
    try {
      const { url, slug, expiresAt } = await window.api.share.publish(docId)
      setState({ shared: true, url, slug, expiresAt })
      // The link is live regardless of whether the clipboard write succeeds, so
      // isolate it: a clipboard rejection must not read as a share failure.
      try {
        await navigator.clipboard.writeText(url)
        toast.success('Link copied')
      } catch {
        toast.success('Link created')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to share')
    } finally {
      setBusy(false)
    }
  }, [docId])

  // Re-push the current document content to the existing share. The main
  // process reuses the stored slug, so the public URL stays the same.
  const handleUpdate = useCallback(async () => {
    if (!docId) return
    setBusy(true)
    try {
      const { url, slug, expiresAt } = await window.api.share.publish(docId)
      setState({ shared: true, url, slug, expiresAt })
      toast.success('Published version updated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setBusy(false)
    }
  }, [docId])

  const handleCopy = useCallback(async () => {
    if (!state.url) return
    try {
      await navigator.clipboard.writeText(state.url)
      toast.success('Link copied')
    } catch {
      toast.error('Failed to copy link')
    }
  }, [state.url])

  const handleUnpublish = useCallback(async () => {
    if (!docId) return
    setBusy(true)
    try {
      await window.api.share.unpublish(docId)
      setState({ shared: false })
      toast.success('Link removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to unshare')
    } finally {
      setBusy(false)
    }
  }, [docId])

  const expiry = describeExpiry(state.expiresAt)
  const needsAttention = state.shared && (expiry?.soon || expiry?.expired)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={!canShare}
          className={cn(
            'relative rounded-sm p-1 transition-colors hover:bg-muted shrink-0 disabled:opacity-40 disabled:pointer-events-none',
            state.shared ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
          title={
            state.shared
              ? expiry
                ? `Shared — ${expiry.label.toLowerCase()}`
                : 'Shared — manage link'
              : 'Share'
          }
        >
          <Share2 className="h-4 w-4" />
          {needsAttention && (
            <span
              className={cn(
                'absolute right-0.5 top-0.5 size-1.5 rounded-full ring-1 ring-background',
                expiry?.expired ? 'bg-destructive' : 'bg-amber-500'
              )}
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {state.shared && state.url ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Public link
            </DropdownMenuLabel>
            <button
              type="button"
              onClick={() => state.url && void window.api.shell.openExternal(state.url)}
              className="block w-full px-2 pb-1.5 text-left text-xs text-primary underline-offset-2 hover:underline break-all select-text"
              title="Open in browser"
            >
              {state.url}
            </button>
            {expiry && (
              <div className={cn('px-2 pb-1.5 text-[11px]', expiry.tone)}>
                {expiry.expired ? 'Link expired — republish to restore it' : expiry.label}
              </div>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={busy}
              onSelect={(e) => {
                e.preventDefault()
                void handleUpdate()
              }}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {busy
                ? expiry?.expired
                  ? 'Republishing…'
                  : 'Updating…'
                : expiry?.expired
                  ? 'Republish to restore'
                  : 'Update published version'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void handleCopy()
              }}
            >
              <Copy className="size-3.5" />
              Copy link
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={busy}
              onSelect={(e) => {
                e.preventDefault()
                void handleUnpublish()
              }}
            >
              <Link2Off className="size-3.5" />
              Unshare
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem
            disabled={busy}
            onSelect={(e) => {
              e.preventDefault()
              void handlePublish()
            }}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Share2 className="size-3.5" />
            )}
            {busy ? 'Publishing…' : 'Create public link'}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
