import { useState, useEffect } from 'react'
import { Check, Loader2, UploadCloud } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@renderer/components/ui/dialog'
import { useAccount } from '@renderer/hooks/useAccount'

/** Strict release-only semver, mirrored from the registry contract. */
const VERSION_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** Settings key remembering the user's claimed publisher handle after the first publish. */
const HANDLE_SETTING_KEY = 'registryHandle'

function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split('.').map(Number)
  return `${major}.${minor}.${patch + 1}`
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

export interface PublishTarget {
  type: 'plugin' | 'skill'
  /** Plugin id or skill name — the local identity the manage UI shows. */
  localId: string
  /** Display name. */
  name: string
  /** The plugin manifest's current version (skills have none on disk). */
  currentVersion?: string
}

interface PublishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: PublishTarget | null
}

/**
 * Publish a locally-authored skill/plugin to the community registry (§9.4).
 * First-ever publish prompts for a publisher handle (validated client-side
 * against the same rules the worker enforces; the claim itself is atomic
 * server-side inside the publish). Publishing is a deliberate manual action —
 * this flow is never exposed to the agent.
 */
export function PublishDialog({ open, onOpenChange, target }: PublishDialogProps) {
  const { account, loading: accountLoading, signingIn, signIn } = useAccount()
  const [storedHandle, setStoredHandle] = useState<string | null>(null)
  const [handleInput, setHandleInput] = useState('')
  const [version, setVersion] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishedId, setPublishedId] = useState<string | null>(null)

  // On open: load the remembered handle and derive a version suggestion —
  // the manifest's version for plugins, and (when the item was published
  // before) a patch bump of the registry's latest version.
  useEffect(() => {
    if (!open || !target) return
    let cancelled = false
    setError(null)
    setPublishedId(null)
    setPublishing(false)
    ;(async () => {
      const remembered = await window.api.settings.get(HANDLE_SETTING_KEY)
      if (cancelled) return
      setStoredHandle(remembered || null)
      setHandleInput(remembered || '')

      let suggestion =
        target.currentVersion && VERSION_REGEX.test(target.currentVersion)
          ? target.currentVersion
          : '1.0.0'
      if (remembered) {
        try {
          // null = not published yet; keep the local suggestion.
          const item = await window.api.registry.item(`${remembered}/${target.localId}`)
          if (item && VERSION_REGEX.test(item.latestVersion)) {
            const bumped = bumpPatch(item.latestVersion)
            if (compareVersions(suggestion, bumped) < 0) suggestion = bumped
          }
        } catch {
          // Registry unreachable — keep the local suggestion.
        }
      }
      if (!cancelled) setVersion(suggestion)
    })()
    return () => {
      cancelled = true
    }
  }, [open, target])

  const needsHandle = !storedHandle
  const versionValid = VERSION_REGEX.test(version)
  const canPublish =
    !!account && !!target && !publishing && versionValid && (!needsHandle || !!handleInput.trim())

  async function handlePublish() {
    if (!target || !canPublish) return
    setError(null)
    if (needsHandle) {
      const check = await window.api.registry.claimHandle(handleInput.trim())
      if (!check.ok) {
        setError(check.error ?? 'Invalid handle.')
        return
      }
    }
    setPublishing(true)
    try {
      const result = await window.api.registry.publishLocal({
        type: target.type,
        localId: target.localId,
        version,
        handle: needsHandle ? handleInput.trim() : undefined
      })
      const claimedHandle = result.id.split('/')[0]
      if (claimedHandle) {
        await window.api.settings.set(HANDLE_SETTING_KEY, claimedHandle)
        setStoredHandle(claimedHandle)
      }
      setPublishedId(result.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Publish to community marketplace</DialogTitle>
          <DialogDescription>
            Share {target ? `“${target.name}”` : 'this item'} with every Green Tea user. Published
            versions are immutable and public under your handle.
          </DialogDescription>
        </DialogHeader>

        {publishedId ? (
          <div className="space-y-3">
            <p className="inline-flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <Check className="size-4" />
              Published as <span className="font-mono">{publishedId}</span> v{version}
            </p>
            <button
              type="button"
              className="h-9 rounded-lg bg-accent text-accent-foreground px-3 text-sm"
              onClick={() => onOpenChange(false)}
            >
              Done
            </button>
          </div>
        ) : !account && !accountLoading ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Publishing requires a Green Tea account so items are attributed to a publisher handle.
            </p>
            <button
              type="button"
              className="h-9 rounded-lg bg-accent text-accent-foreground px-3 text-sm disabled:opacity-50"
              disabled={signingIn}
              onClick={() => void signIn()}
            >
              {signingIn ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {needsHandle && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="publish-handle">
                  Publisher handle
                </label>
                <input
                  id="publish-handle"
                  type="text"
                  className="w-full h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3 font-mono"
                  placeholder="your-handle"
                  value={handleInput}
                  onChange={(e) => setHandleInput(e.target.value)}
                  disabled={publishing}
                />
                <p className="text-xs text-muted-foreground">
                  Claimed on your first publish, permanent, and shown as the author of everything
                  you publish (e.g. {handleInput.trim() || 'your-handle'}/
                  {target?.localId ?? 'item'}).
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="publish-version">
                Version
              </label>
              <input
                id="publish-version"
                type="text"
                className="w-full h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3 font-mono"
                placeholder="1.0.0"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={publishing}
              />
              {!versionValid && version.length > 0 && (
                <p className="text-xs text-red-500">
                  Use release semver like 1.2.0 (no “v” prefix, no prerelease tags).
                </p>
              )}
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="h-9 rounded-lg bg-muted text-muted-foreground px-3 text-sm hover:text-foreground"
                onClick={() => onOpenChange(false)}
                disabled={publishing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent text-accent-foreground px-3 text-sm disabled:opacity-50"
                disabled={!canPublish}
                onClick={() => void handlePublish()}
              >
                {publishing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <UploadCloud className="size-4" />
                )}
                Publish
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
