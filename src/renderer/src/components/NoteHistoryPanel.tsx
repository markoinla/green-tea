import React, { useCallback, useEffect, useRef, useState } from 'react'
import { History, ArrowLeft, RotateCcw, Bot, PenLine, Loader2 } from 'lucide-react'
import { useNoteHistory, type NoteCommit } from '@renderer/hooks/useNoteHistory'
import { useOutsideDismiss } from '@renderer/hooks/useOutsideDismiss'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@renderer/components/ui/sheet'
import { parseDiffLines, type DiffLineType } from './note-history-diff'

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

const DIFF_LINE_CLASS: Record<DiffLineType, string> = {
  add: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
  del: 'text-red-600 dark:text-red-400 bg-red-500/10',
  hunk: 'text-sky-600 dark:text-sky-400',
  header: 'text-muted-foreground',
  meta: 'text-muted-foreground/60',
  context: 'text-foreground/70'
}

/**
 * Per-note Version History (Phase 1, §5) — a self-contained trigger button + Sheet
 * showing the saved versions of this note (git commits that touched it), attributed
 * to the agent vs. the app. Master/detail: the version list, then a what-changed
 * view with a non-destructive restore (§4.7). User-facing copy avoids git jargon.
 */
export function NoteHistoryPanel({ documentId }: { documentId: string | null }): React.ReactNode {
  const [open, setOpen] = useState(false)
  const { commits, loading, getDiff, restore } = useNoteHistory(open ? documentId : null)
  const [selected, setSelected] = useState<NoteCommit | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Reset the detail view whenever the panel closes or the note changes.
  useEffect(() => {
    if (!open) setSelected(null)
  }, [open])
  useEffect(() => {
    setSelected(null)
  }, [documentId])

  const close = useCallback(() => setOpen(false), [])
  useOutsideDismiss(open, close, triggerRef)

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="text-muted-foreground hover:text-foreground rounded-sm p-1 transition-colors hover:bg-muted shrink-0"
        title="Version history"
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
              {selected ? (
                <button
                  onClick={() => setSelected(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Back to history"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              ) : (
                <History className="h-4 w-4" />
              )}
              {selected ? 'What changed' : 'Version History'}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {selected ? 'What changed since this version' : 'Every version of this file'}
            </SheetDescription>
          </SheetHeader>

          {selected ? (
            <CommitDiffView
              documentId={documentId}
              commit={selected}
              getDiff={getDiff}
              restore={restore}
              onRestored={() => setOpen(false)}
            />
          ) : (
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-2 py-2">
                {loading && commits.length === 0 && (
                  <p className="text-xs text-muted-foreground py-8 text-center">Loading...</p>
                )}
                {!loading && commits.length === 0 && (
                  <p className="text-xs text-muted-foreground py-8 text-center">
                    No earlier versions of this file yet.
                  </p>
                )}
                <div className="space-y-0.5">
                  {commits.map((c) => (
                    <CommitRow key={c.oid} commit={c} onSelect={() => setSelected(c)} />
                  ))}
                </div>
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

function CommitRow({
  commit,
  onSelect
}: {
  commit: NoteCommit
  onSelect: () => void
}): React.ReactNode {
  return (
    <button
      onClick={onSelect}
      className="group w-full text-left flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors"
    >
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
    </button>
  )
}

function CommitDiffView({
  documentId,
  commit,
  getDiff,
  restore,
  onRestored
}: {
  documentId: string | null
  commit: NoteCommit
  getDiff: (ref: string) => Promise<string>
  restore: (ref: string) => Promise<unknown>
  onRestored: () => void
}): React.ReactNode {
  const [patch, setPatch] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPatch(null)
    getDiff(commit.oid).then((p) => {
      if (!cancelled) setPatch(p)
    })
    return () => {
      cancelled = true
    }
  }, [commit.oid, getDiff])

  const handleRestore = useCallback(async () => {
    if (!documentId) return
    setRestoring(true)
    try {
      await restore(commit.oid)
      onRestored()
    } finally {
      setRestoring(false)
    }
  }, [documentId, commit.oid, restore, onRestored])

  const lines = patch === null ? [] : parseDiffLines(patch)

  return (
    <>
      <div className="px-4 py-2 border-b dark:border-white/5 border-black/5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground truncate">
          {formatCommitTime(commit.timestamp)} · {commit.oid.slice(0, 7)}
        </span>
        <button
          onClick={handleRestore}
          disabled={restoring}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted disabled:opacity-50"
          title="Go back to this version. Your current file is saved first, so nothing is lost."
        >
          {restoring ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          Restore
        </button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        {patch === null ? (
          <p className="text-xs text-muted-foreground py-8 text-center">Loading…</p>
        ) : lines.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            This version is identical to your file now.
          </p>
        ) : (
          <pre className="text-[11px] leading-relaxed font-mono px-0 py-1">
            {lines.map((l, i) => (
              <div
                key={i}
                className={`px-3 whitespace-pre-wrap break-words ${DIFF_LINE_CLASS[l.type]}`}
              >
                {l.text || ' '}
              </div>
            ))}
          </pre>
        )}
      </ScrollArea>
    </>
  )
}
