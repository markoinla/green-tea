import React, { useCallback, useState } from 'react'
import { History, RotateCcw, Bot, PenLine, Loader2, GitCommitVertical, Check } from 'lucide-react'
import { useVaultHistory, type VaultCommit } from '@renderer/hooks/useVaultHistory'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Input } from '@renderer/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@renderer/components/ui/sheet'

/** Relative time from an epoch-millisecond git commit timestamp. */
function formatCommitTime(ms: number): string {
  const diffSecs = Math.floor((Date.now() - ms) / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Vault-level git history (Phase 2, §6) — a trigger button + Sheet that lists every
 * checkpoint/commit across the WHOLE workspace and lets the user (a) create a manual
 * named checkpoint and (b) non-destructively restore the entire vault to any commit
 * (§4.7: the current state is flushed to git first, so nothing is ever lost). Sits
 * above the per-note `NoteHistoryPanel` at the atomic, cross-file altitude.
 */
export function VaultHistoryPanel({
  workspaceId
}: {
  workspaceId: string | null
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  const { commits, loading, checkpoint, restore } = useVaultHistory(open ? workspaceId : null)
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  // The commit the user has armed to restore — a second click on the row confirms.
  const [confirmOid, setConfirmOid] = useState<string | null>(null)
  const [restoringOid, setRestoringOid] = useState<string | null>(null)

  const handleCheckpoint = useCallback(async () => {
    const name = label.trim()
    if (!name || saving) return
    setSaving(true)
    try {
      await checkpoint(name)
      setLabel('')
    } finally {
      setSaving(false)
    }
  }, [label, saving, checkpoint])

  const handleRestore = useCallback(
    async (oid: string) => {
      setRestoringOid(oid)
      try {
        await restore(oid)
        setConfirmOid(null)
      } finally {
        setRestoringOid(null)
      }
    },
    [restore]
  )

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground rounded-sm p-1 transition-colors hover:bg-muted shrink-0"
        title="Vault history (checkpoints)"
      >
        <History className="h-4 w-4" />
      </button>
      <Sheet open={open} onOpenChange={setOpen} modal={false}>
        <SheetContent
          side="right"
          className="w-[360px] sm:max-w-[360px] p-0 flex flex-col"
          showOverlay={false}
          showCloseButton={false}
        >
          <SheetHeader className="px-4 pt-4 pb-2 border-b dark:border-white/5 border-black/5">
            <SheetTitle className="text-sm flex items-center gap-2">
              <GitCommitVertical className="h-4 w-4" />
              Vault History
            </SheetTitle>
            <SheetDescription className="text-xs">
              Checkpoints across the whole workspace — restore everything to a point in time
            </SheetDescription>
          </SheetHeader>

          <div className="px-3 py-2 border-b dark:border-white/5 border-black/5 flex items-center gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCheckpoint()
              }}
              placeholder="Name a checkpoint…"
              className="h-8 text-xs"
            />
            <button
              onClick={handleCheckpoint}
              disabled={!label.trim() || saving}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded hover:bg-muted disabled:opacity-50 shrink-0"
              title="Create a named checkpoint of the current vault state"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </button>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-2 py-2">
              {loading && commits.length === 0 && (
                <p className="text-xs text-muted-foreground py-8 text-center">Loading…</p>
              )}
              {!loading && commits.length === 0 && (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  No checkpoints yet for this workspace.
                </p>
              )}
              <div className="space-y-0.5">
                {commits.map((c) => (
                  <CommitRow
                    key={c.oid}
                    commit={c}
                    armed={confirmOid === c.oid}
                    restoring={restoringOid === c.oid}
                    onArm={() => setConfirmOid(c.oid)}
                    onConfirm={() => handleRestore(c.oid)}
                    onCancel={() => setConfirmOid(null)}
                  />
                ))}
              </div>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  )
}

function CommitRow({
  commit,
  armed,
  restoring,
  onArm,
  onConfirm,
  onCancel
}: {
  commit: VaultCommit
  armed: boolean
  restoring: boolean
  onArm: () => void
  onConfirm: () => void
  onCancel: () => void
}): React.ReactNode {
  return (
    <div className="group w-full flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors">
      <span
        className={`mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
          commit.isAgent
            ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
            : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
        }`}
      >
        {commit.isAgent ? <Bot className="h-3 w-3" /> : <PenLine className="h-3 w-3" />}
        {commit.isAgent ? 'Agent' : 'App'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-foreground/85 truncate">{commit.message}</span>
        <span className="block text-[11px] text-muted-foreground">
          {formatCommitTime(commit.timestamp)} · {commit.oid.slice(0, 7)}
        </span>
      </span>
      {armed ? (
        <span className="flex items-center gap-1 shrink-0">
          <button
            onClick={onConfirm}
            disabled={restoring}
            className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 rounded px-1.5 py-1 disabled:opacity-50"
            title="Confirm: restore the whole vault to this commit (current state is saved first)"
          >
            {restoring ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Confirm
          </button>
          <button
            onClick={onCancel}
            disabled={restoring}
            className="text-[11px] text-muted-foreground hover:text-foreground rounded px-1.5 py-1 disabled:opacity-50"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={onArm}
          className="shrink-0 text-muted-foreground hover:text-foreground rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Restore the whole vault to this commit"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
