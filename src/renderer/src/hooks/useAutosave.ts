import { useEffect, useCallback } from 'react'
import type { JSONContent } from '@tiptap/react'

const DEBOUNCE_MS = 500

// Pending autosave state is hoisted to module scope (keyed by document id) so
// that the conflict flow (useDocument) can inspect and cancel an armed save —
// otherwise a queued 500ms flush would overwrite an external change the user is
// being asked about. One source of truth for save/dirty/cancel.
//
// Note: the app's own saves are NOT echoed back as content-changed events — the
// vault watcher is the single source of external-change notifications and it
// recognizes our own writes via a content-hash registry. So there is no local
// "is this my echo?" guard here; the renderer only ever sees genuine external
// changes.
interface Pending {
  content: JSONContent
  timer: ReturnType<typeof setTimeout>
}
const pending = new Map<string, Pending>()
const conflicted = new Set<string>()

export function hasUnsavedEdits(id: string): boolean {
  return pending.has(id)
}

/** True while id has an unresolved (open or deferred) conflict. Eviction and the
 *  unmount flush MUST consult this so they never overwrite the external change. */
export function hasConflict(id: string): boolean {
  return conflicted.has(id)
}

/** Mark/unmark that an unresolved conflict dialog is open for id (guards the unmount flush). */
export function setConflictOpen(id: string, open: boolean): void {
  if (open) conflicted.add(id)
  else conflicted.delete(id)
}

/** Drop any queued autosave for id WITHOUT writing it (used when a conflict opens). */
export function cancelPending(id: string): void {
  const p = pending.get(id)
  if (p) {
    clearTimeout(p.timer)
    pending.delete(id)
  }
}

function doFlush(id: string): Promise<void> {
  const p = pending.get(id)
  if (!p) return Promise.resolve()
  clearTimeout(p.timer)
  pending.delete(id)
  const content = JSON.stringify(p.content)
  return window.api.documents.update(id, { content }).then(
    () => {},
    (err) => {
      console.error('[autosave] failed to save document', id, err)
    }
  )
}

/**
 * Flush id's queued autosave and await the in-flight write — UNLESS id has an
 * open/deferred conflict, in which case the queued edit is discarded (the
 * discard-local path) rather than silently overwriting the external change.
 * Used by closeTab (so close-then-reopen can't load stale content) and the
 * workspace-switch / quit sequences.
 */
export function flush(id: string): Promise<void> {
  if (conflicted.has(id)) {
    cancelPending(id)
    return Promise.resolve()
  }
  return doFlush(id)
}

/** Flush every pending autosave (conflict-respecting) and await them all. */
export function flushAll(): Promise<void> {
  const ids = [...pending.keys()]
  return Promise.all(ids.map((id) => flush(id))).then(() => {})
}

export function useAutosave(documentId: string) {
  const save = useCallback(
    (content: JSONContent) => {
      const prev = pending.get(documentId)
      if (prev) clearTimeout(prev.timer)
      const timer = setTimeout(() => doFlush(documentId), DEBOUNCE_MS)
      pending.set(documentId, { content, timer })
    },
    [documentId]
  )

  // Flush on unmount (note switch, app close) — EXCEPT when a conflict dialog is
  // open for this id, in which case the queued edit is discarded rather than
  // silently overwriting the external change the user is resolving.
  useEffect(() => {
    return () => {
      if (conflicted.has(documentId)) {
        cancelPending(documentId)
        return
      }
      doFlush(documentId)
    }
  }, [documentId])

  return save
}
