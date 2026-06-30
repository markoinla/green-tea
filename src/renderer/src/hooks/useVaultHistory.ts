import { useState, useEffect, useCallback } from 'react'
import type { GitLogEntry, VaultRestoreResult } from '../../../main/git/git-service'

/** Identity stamped on commits made at the agent boundary (git-service.ts). */
const AGENT_AUTHOR_EMAIL = 'agent@greentea.app'

export interface VaultCommit extends GitLogEntry {
  /** True when this commit was made by the agent (pre-patch / turn-end) vs. the app. */
  isAgent: boolean
}

interface UseVaultHistoryResult {
  commits: VaultCommit[]
  loading: boolean
  refresh: () => void
  /** Create a manual, vault-wide named checkpoint; returns the new oid (null if clean). */
  checkpoint: (message: string) => Promise<string | null>
  /** Non-destructively restore the WHOLE vault to `ref` (§4.7); editors reload via events. */
  restore: (ref: string) => Promise<VaultRestoreResult>
}

/**
 * Vault-level git history (Phase 2, §6). Lists every commit/checkpoint across the
 * whole workspace (newest first), and exposes a manual named-checkpoint action plus a
 * non-destructive whole-vault restore. Sits ABOVE the per-note `useNoteHistory`: this
 * is the atomic, cross-file altitude where "restore everything to this point" lives.
 *
 * Re-fetches on any document change (a new pre-patch / autosave / checkpoint / restore
 * commit surfaces as a content/structure change) so the list stays live.
 */
export function useVaultHistory(workspaceId: string | null): UseVaultHistoryResult {
  const [commits, setCommits] = useState<VaultCommit[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    if (!workspaceId) {
      setCommits([])
      return
    }
    setLoading(true)
    window.api.git
      .vaultLog(workspaceId)
      .then((result) => {
        setCommits(result.map((c) => ({ ...c, isAgent: c.authorEmail === AGENT_AUTHOR_EMAIL })))
        setLoading(false)
      })
      .catch(() => {
        setCommits([])
        setLoading(false)
      })
  }, [workspaceId])

  useEffect(() => {
    refresh()
    const unsubContent = window.api.onDocumentContentChanged(() => refresh())
    const unsubDocs = window.api.onDocumentsChanged(() => refresh())
    return () => {
      unsubContent()
      unsubDocs()
    }
  }, [refresh])

  const checkpoint = useCallback(
    (message: string) => {
      if (!workspaceId) return Promise.resolve(null)
      return window.api.git.checkpoint(workspaceId, message).then((oid) => {
        refresh()
        return oid
      })
    },
    [workspaceId, refresh]
  )

  const restore = useCallback(
    (ref: string) => {
      if (!workspaceId) return Promise.reject(new Error('No workspace selected'))
      return window.api.git.vaultRestore(workspaceId, ref).then((result) => {
        refresh()
        return result
      })
    },
    [workspaceId, refresh]
  )

  return { commits, loading, refresh, checkpoint, restore }
}
