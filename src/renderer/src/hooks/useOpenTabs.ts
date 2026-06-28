import { useCallback, useEffect, useRef, useState } from 'react'
import { flush as flushAutosave, flushAll } from './useAutosave'
import { isFileTabId } from '../lib/tab-ids'
import {
  EMPTY_HISTORY,
  EMPTY_TAB_STATE,
  activateByIndex as reduceActivateByIndex,
  activateTab as reduceActivate,
  canNavBack,
  canNavForward,
  closeAll as reduceCloseAll,
  closeOthers as reduceCloseOthers,
  closeTab as reduceClose,
  closeToRight as reduceCloseToRight,
  cycle as reduceCycle,
  openTab as reduceOpen,
  reconcileDeletions as reduceReconcile,
  reconcileNavHistory,
  recordNav,
  reorderTab as reduceReorder,
  type NavHistory,
  type OpenOpts,
  type TabState
} from './tab-state'

const PERSIST_DEBOUNCE_MS = 400

export interface UseOpenTabsResult {
  openDocIds: string[]
  activeDocId: string | null
  /** False until the current workspace's persisted tabs have resolved. */
  hydrated: boolean
  openTab: (docId: string, opts?: OpenOpts) => void
  closeTab: (docId: string) => void
  closeOthers: (docId: string) => void
  closeToRight: (docId: string) => void
  closeAll: () => void
  activateTab: (docId: string) => void
  activateByIndex: (i: number) => void
  cycle: (dir: 1 | -1) => void
  reorderTab: (from: number, to: number) => void
  reconcileDeletions: (existingIds: Set<string>) => void
  /** Re-activate the previously-viewed note (reopening it if its tab was closed). */
  goBack: () => void
  /** Redo a Back — re-activate the note ahead in the trail. */
  goForward: () => void
  /** Whether there's an earlier note to go Back to. */
  canGoBack: boolean
  /** Whether there's a later note to go Forward to. */
  canGoForward: boolean
  /** Immediate, non-debounced tab-state write (quit hook); awaitable. */
  flushNow: () => Promise<void>
}

export function useOpenTabs(workspaceId: string | null): UseOpenTabsResult {
  const [tabState, setTabState] = useState<TabState>(EMPTY_TAB_STATE)
  const [hydrated, setHydrated] = useState(false)

  // Browser-style back/forward trail over the active note. In-memory only (never
  // persisted) and reset on workspace switch — see the workspace-switch effect.
  const [history, setHistory] = useState<NavHistory>(EMPTY_HISTORY)
  const historyRef = useRef(history)
  historyRef.current = history
  // When Back/Forward drives the active doc, the resulting `activeDocId` change
  // must NOT be recorded as a new navigation. Holds the id we're navigating to so
  // the recording effect can recognise and skip exactly that change.
  const suppressNavRef = useRef<string | null>(null)

  // Refs so the workspace-switch sequence and quit hook can read the live values
  // without re-subscribing.
  const stateRef = useRef(tabState)
  stateRef.current = tabState
  const loadedWorkspaceRef = useRef<string | null>(null)
  const hydratedRef = useRef(false)
  hydratedRef.current = hydrated
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistNow = useCallback((wsId: string, state: TabState): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    return window.api.tabs.set(wsId, state)
  }, [])

  // ── Workspace-switch sequence (findings #5, #11) ─────────────────────────────
  // 1. clear in-memory state synchronously so A's active can't leak into B's
  //    render; 2. flush A's outgoing autosaves; 3. write A's tab-state under A's
  //    key (captured by ref, not current state); 4. hydrate B.
  useEffect(() => {
    const prevWorkspace = loadedWorkspaceRef.current
    const prevState = stateRef.current
    loadedWorkspaceRef.current = workspaceId

    setTabState(EMPTY_TAB_STATE)
    setHydrated(false)
    // History is per-workspace; drop the previous workspace's trail.
    setHistory(EMPTY_HISTORY)
    suppressNavRef.current = null

    let cancelled = false
    const isStale = (): boolean => cancelled || loadedWorkspaceRef.current !== workspaceId

    void (async () => {
      await flushAll()
      if (prevWorkspace && prevWorkspace !== workspaceId) {
        persistNow(prevWorkspace, prevState)
      }
      if (isStale()) return

      if (!workspaceId) {
        setHydrated(true)
        return
      }

      const persisted = await window.api.tabs.get(workspaceId).catch(() => null)
      if (isStale()) return

      let next: TabState =
        persisted && Array.isArray(persisted.openDocIds)
          ? {
              openDocIds: persisted.openDocIds,
              activeDocId: persisted.activeDocId ?? null
            }
          : EMPTY_TAB_STATE

      // Validate persisted ids against what still exists. Guard (finding #12):
      // only prune when `list` resolves non-empty; an all-missing read is treated
      // as suspicious/transient and the persisted list is kept as-is.
      if (next.openDocIds.length > 0) {
        const docs = await window.api.documents.list(workspaceId).catch(() => [])
        if (isStale()) return
        if (docs.length > 0) {
          const existing = new Set(docs.map((d) => d.id))
          // Exempt `file:` tabs (HTML artifacts) — they live in workspace_files,
          // not the documents list, so a missing-from-documents check must not
          // prune them. They survive a workspace switch as-is.
          const openDocIds = next.openDocIds.filter((id) => isFileTabId(id) || existing.has(id))
          if (openDocIds.length !== next.openDocIds.length) {
            const activeDocId =
              next.activeDocId && openDocIds.includes(next.activeDocId)
                ? next.activeDocId
                : (openDocIds[0] ?? null)
            next = { openDocIds, activeDocId }
          }
        }
      }

      if (isStale()) return
      setTabState(next)
      setHydrated(true)
    })()

    return () => {
      cancelled = true
    }
  }, [workspaceId, persistNow])

  // Debounced persist on every state change (once hydrated for this workspace).
  useEffect(() => {
    if (!hydrated || !workspaceId) return
    if (loadedWorkspaceRef.current !== workspaceId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void window.api.tabs.set(workspaceId, stateRef.current)
    }, PERSIST_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
    }
  }, [tabState, hydrated, workspaceId])

  // Record every change to the active note as a navigation. `activeDocId` is the
  // single chokepoint, so this captures wiki-links, sidebar/palette opens, tab
  // clicks and Ctrl-Tab cycling alike — de-duped, and excluding the Back/Forward
  // moves themselves (flagged via suppressNavRef).
  useEffect(() => {
    const id = tabState.activeDocId
    if (!id) return
    const suppressed = suppressNavRef.current
    suppressNavRef.current = null
    if (suppressed === id) return
    setHistory((h) => recordNav(h, id))
  }, [tabState.activeDocId])

  // Re-activate `targetId` (already known to exist in the trail): focus its tab
  // if still open, else reopen it by reusing the active slot — matching the app's
  // default in-place navigation. Flag the move so it isn't recorded as new.
  const navigateTo = useCallback((targetId: string) => {
    suppressNavRef.current = targetId
    setTabState((s) => reduceOpen(s, targetId))
  }, [])

  const goBack = useCallback(() => {
    const h = historyRef.current
    if (!canNavBack(h)) return
    const target = h.stack[h.index - 1]
    setHistory({ stack: h.stack, index: h.index - 1 })
    navigateTo(target)
  }, [navigateTo])

  const goForward = useCallback(() => {
    const h = historyRef.current
    if (!canNavForward(h)) return
    const target = h.stack[h.index + 1]
    setHistory({ stack: h.stack, index: h.index + 1 })
    navigateTo(target)
  }, [navigateTo])

  const flushNow = useCallback((): Promise<void> => {
    const wsId = loadedWorkspaceRef.current
    if (!wsId || !hydratedRef.current) return Promise.resolve()
    return persistNow(wsId, stateRef.current)
  }, [persistNow])

  const openTab = useCallback((docId: string, opts?: OpenOpts) => {
    setTabState((s) => reduceOpen(s, docId, opts))
  }, [])

  const closeTab = useCallback((docId: string) => {
    // Flush before close (finding #17) so close-then-reopen can't read stale
    // content; flush() is a no-op for clean/conflicted ids.
    void flushAutosave(docId)
    setTabState((s) => reduceClose(s, docId))
  }, [])

  const closeOthers = useCallback((docId: string) => {
    setTabState((s) => reduceCloseOthers(s, docId))
  }, [])

  const closeToRight = useCallback((docId: string) => {
    setTabState((s) => reduceCloseToRight(s, docId))
  }, [])

  const closeAll = useCallback(() => {
    setTabState(() => reduceCloseAll())
  }, [])

  const activateTab = useCallback((docId: string) => {
    setTabState((s) => reduceActivate(s, docId))
  }, [])

  const activateByIndex = useCallback((i: number) => {
    setTabState((s) => reduceActivateByIndex(s, i))
  }, [])

  const cycle = useCallback((dir: 1 | -1) => {
    setTabState((s) => reduceCycle(s, dir))
  }, [])

  const reorderTab = useCallback((from: number, to: number) => {
    setTabState((s) => reduceReorder(s, from, to))
  }, [])

  const reconcileDeletions = useCallback((existingIds: Set<string>) => {
    // Drop deleted notes from the trail too, so Back/Forward never lands on one.
    // Park the cursor on whatever survivor the tab reducer re-activates, so the
    // recording effect's follow-up no-ops instead of truncating the forward trail.
    const keep = (id: string): boolean => isFileTabId(id) || existingIds.has(id)
    const nextActive = reduceReconcile(stateRef.current, existingIds).activeDocId
    setTabState((s) => reduceReconcile(s, existingIds))
    if (existingIds.size > 0) {
      setHistory((h) => reconcileNavHistory(h, keep, nextActive))
    }
  }, [])

  return {
    openDocIds: tabState.openDocIds,
    activeDocId: tabState.activeDocId,
    hydrated,
    openTab,
    closeTab,
    closeOthers,
    closeToRight,
    closeAll,
    activateTab,
    activateByIndex,
    cycle,
    reorderTab,
    reconcileDeletions,
    goBack,
    goForward,
    canGoBack: canNavBack(history),
    canGoForward: canNavForward(history),
    flushNow
  }
}
