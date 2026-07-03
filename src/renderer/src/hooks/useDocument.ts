import { useState, useEffect, useRef, useCallback } from 'react'
import type { JSONContent } from '@tiptap/react'
import type { Document } from '../../../main/database/types'
import { hasUnsavedEdits, cancelPending, setConflictOpen } from './useAutosave'

interface Conflict {
  /** The note's content on disk, to apply if the user chooses "reload". */
  externalContent: JSONContent | null
}

interface UseDocumentResult {
  document: Document | null
  loading: boolean
  /** Incremented each time external (non-local) content arrives. */
  externalContentVersion: number
  /** Parsed JSON content from the latest external update, or null. */
  externalContent: JSONContent | null
  /** Non-null when an external change arrived while the buffer had unsaved edits. */
  conflict: Conflict | null
  resolveConflict: (choice: 'reload' | 'keepMine') => void
}

function parseContent(doc: Document | null | undefined): JSONContent | null {
  try {
    return doc?.content ? (JSON.parse(doc.content) as JSONContent) : null
  } catch {
    return null
  }
}

export function useDocument(id: string | null, isActive = true): UseDocumentResult {
  const [document, setDocument] = useState<Document | null>(null)
  const [loading, setLoading] = useState(id !== null)
  const [externalContentVersion, setExternalContentVersion] = useState(0)
  const externalContentRef = useRef<JSONContent | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const conflictRef = useRef<Conflict | null>(null)
  conflictRef.current = conflict
  // When an external change collides with unsaved edits on an INACTIVE (hidden)
  // tab we still protect the disk synchronously, but stash the dialog here and
  // surface it only on activation — a hidden tab must never mount a focus-trapping
  // dialog (finding #2).
  const deferredConflictRef = useRef<Conflict | null>(null)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive
  // Monotonic request id for resolveConflict's get() — it fires from an event
  // handler (not an effect), so it can't share the effect-scoped guards. Bumped
  // on issue and on effect cleanup (unmount / id change) to drop stale results.
  const reloadReqRef = useRef(0)

  useEffect(() => {
    if (!id) {
      setDocument(null)
      return
    }

    // Currency guards: `cancelled` drops resolutions after unmount / id change;
    // the per-handler request ids drop out-of-order resolutions (two rapid
    // external changes must never leave the OLDER disk content in
    // externalContentRef after the version bump).
    let cancelled = false
    let contentReq = 0
    let structuralReq = 0

    setLoading(true)
    window.api.documents.get(id).then((doc) => {
      if (cancelled) return
      setDocument(doc ?? null)
      setLoading(false)
    })

    // Content changes from outside this editor: external file edits (via the
    // vault watcher), agent patches, version restores. The app's own autosaves
    // are NOT echoed here (the watcher recognizes and drops them).
    const unsubContent = window.api.onDocumentContentChanged((data) => {
      if (data.id !== id) return

      // CRITICAL: decide and cancel SYNCHRONOUSLY, before any await. If we have
      // unsaved edits, cancel the armed autosave NOW so its 500ms flush can't
      // fire during the async get() below and silently overwrite the external
      // change on disk (the conflict-then-cancel race).
      const dirty = hasUnsavedEdits(id)
      if (dirty) {
        cancelPending(id)
        setConflictOpen(id, true)
      }

      const req = ++contentReq
      window.api.documents.get(id).then((doc) => {
        // Only the latest external change may land: a slower, earlier get()
        // resolving after a newer one would put stale content in the ref.
        if (cancelled || req !== contentReq) return
        const parsed = parseContent(doc)
        if (dirty) {
          // Keep the user's live buffer; offer the disk version via the dialog.
          // Active tab → open the dialog now; inactive tab → defer until activation
          // (the conflicted flag, already set above, protects the disk meanwhile).
          if (isActiveRef.current) {
            setConflict({ externalContent: parsed })
          } else {
            deferredConflictRef.current = { externalContent: parsed }
          }
          return
        }
        setDocument(doc ?? null)
        externalContentRef.current = parsed
        setExternalContentVersion((v) => v + 1)
      })
    })

    // Structural changes (title, folder, workspace) — refresh metadata
    // but don't bump version (no editor remount needed).
    const unsubStructural = window.api.onDocumentsChanged(() => {
      const req = ++structuralReq
      window.api.documents.get(id).then((doc) => {
        if (cancelled || req !== structuralReq) return
        setDocument(doc ?? null)
      })
    })

    return () => {
      cancelled = true
      // Invalidate any in-flight resolveConflict reload for this id.
      reloadReqRef.current++
      unsubContent()
      unsubStructural()
      // Leaving this note: clear any open-conflict bookkeeping for it.
      setConflictOpen(id, false)
      setConflict(null)
      deferredConflictRef.current = null
    }
  }, [id])

  // When this tab becomes active, surface any conflict that arrived while it was
  // hidden (finding #2).
  useEffect(() => {
    if (isActive && deferredConflictRef.current) {
      setConflict(deferredConflictRef.current)
      deferredConflictRef.current = null
    }
  }, [isActive])

  const resolveConflict = useCallback(
    (choice: 'reload' | 'keepMine') => {
      if (!id) return
      setConflictOpen(id, false)
      const c = conflictRef.current
      setConflict(null)
      if (choice === 'reload') {
        cancelPending(id) // belt-and-suspenders; conflict-open already cancelled it
        externalContentRef.current = c?.externalContent ?? null
        setExternalContentVersion((v) => v + 1) // OutlinerEditor applies in place
        const req = ++reloadReqRef.current
        window.api.documents.get(id).then((doc) => {
          if (req !== reloadReqRef.current) return
          setDocument(doc ?? null)
        })
      }
      // 'keepMine': dismiss. The next keystroke re-arms autosave, which on flush
      // overwrites disk with the user's version (intended — never auto-merge).
    },
    [id]
  )

  return {
    document,
    loading,
    externalContentVersion,
    externalContent: externalContentRef.current,
    conflict,
    resolveConflict
  }
}
