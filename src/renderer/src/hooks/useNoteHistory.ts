import { useState, useEffect, useCallback } from 'react'
import type { GitLogEntry, RestoreResult as GitRestoreResult } from '../../../main/git/git-service'

/** Identity stamped on commits made at the agent-patch boundary (git-service.ts). */
const AGENT_AUTHOR_EMAIL = 'agent@greentea.app'

export interface NoteCommit extends GitLogEntry {
  /** True when this commit was made on the agent-patch boundary (vs. app/manual). */
  isAgent: boolean
}

interface UseNoteHistoryResult {
  commits: NoteCommit[]
  loading: boolean
  refresh: () => void
  /** Unified diff of the note at `ref` vs. the current working tree. */
  getDiff: (ref: string) => Promise<string>
  /** Non-destructive restore of the note to `ref` (§4.7); editor reloads via events. */
  restore: (ref: string) => Promise<GitRestoreResult>
}

/**
 * Per-note git history (Phase 1, §5). Resolves to the note's backing `file_path`
 * main-side, so callers stay in document terms. Lists the commits touching the note
 * (newest first), exposes a diff-against-current and a non-destructive restore.
 *
 * Git commits are vault-wide, atomic across files, and attributed to the agent vs.
 * the app. Re-fetches whenever the note's content changes on disk (a new agent-patch
 * / autosave / restore commit) so the list stays live.
 */
export function useNoteHistory(documentId: string | null): UseNoteHistoryResult {
  const [commits, setCommits] = useState<NoteCommit[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    if (!documentId) {
      setCommits([])
      return
    }
    setLoading(true)
    window.api.git
      .log(documentId)
      .then((result) => {
        setCommits(result.map((c) => ({ ...c, isAgent: c.authorEmail === AGENT_AUTHOR_EMAIL })))
        setLoading(false)
      })
      .catch(() => {
        setCommits([])
        setLoading(false)
      })
  }, [documentId])

  useEffect(() => {
    refresh()
    // A pre-patch / turn-end / restore commit lands as a content change for this
    // note; refresh on it (and on the broad documents:changed) so history is live.
    const unsubContent = window.api.onDocumentContentChanged((data) => {
      if (!documentId || data.id === documentId) refresh()
    })
    const unsubDocs = window.api.onDocumentsChanged(() => refresh())
    return () => {
      unsubContent()
      unsubDocs()
    }
  }, [refresh, documentId])

  const getDiff = useCallback(
    (ref: string) => {
      if (!documentId) return Promise.resolve('')
      return window.api.git.diff(documentId, ref)
    },
    [documentId]
  )

  const restore = useCallback(
    (ref: string) => {
      if (!documentId) return Promise.reject(new Error('No document selected'))
      return window.api.git.restore(documentId, ref)
    },
    [documentId]
  )

  return { commits, loading, refresh, getDiff, restore }
}
