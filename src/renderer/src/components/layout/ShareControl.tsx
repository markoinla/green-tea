import { useState, useEffect, useCallback } from 'react'
import { Share2, Copy, Link2Off, Loader2 } from 'lucide-react'
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
      const { url, slug } = await window.api.share.publish(docId)
      setState({ shared: true, url, slug })
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={!canShare}
          className={cn(
            'rounded-sm p-1 transition-colors hover:bg-muted shrink-0 disabled:opacity-40 disabled:pointer-events-none',
            state.shared ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
          title={state.shared ? 'Shared — manage link' : 'Share'}
        >
          <Share2 className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {state.shared && state.url ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Public link
            </DropdownMenuLabel>
            <div className="px-2 pb-1.5 text-xs text-foreground break-all select-text">
              {state.url}
            </div>
            <DropdownMenuSeparator />
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
