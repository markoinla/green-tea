/**
 * Pure, framework-free tab-state reducer. Kept separate from the React hook so
 * the activate-right / dedupe / reconcile rules are unit-testable in isolation.
 * Every function takes a TabState and returns a NEW TabState (never mutates).
 */

export interface TabState {
  openDocIds: string[]
  activeDocId: string | null
}

export interface OpenOpts {
  /** Open in a new tab instead of replacing the active one. */
  newTab?: boolean
  /** Make the opened tab active (default true). */
  activate?: boolean
}

export const EMPTY_TAB_STATE: TabState = { openDocIds: [], activeDocId: null }

/**
 * Given the doc list AFTER an active tab was removed (and the removed tab's old
 * index), pick the tab to focus: the right neighbour that shifted into the slot,
 * else the new rightmost (fall back left), else null.
 */
function pickAfterClose(openDocIds: string[], removedIndex: number): string | null {
  if (openDocIds.length === 0) return null
  if (removedIndex < openDocIds.length) return openDocIds[removedIndex]
  return openDocIds[openDocIds.length - 1]
}

export function openTab(state: TabState, docId: string, opts: OpenOpts = {}): TabState {
  const { newTab = false, activate = true } = opts

  // Already open → focus it (dedupe). Never add a duplicate.
  if (state.openDocIds.includes(docId)) {
    return activate ? { ...state, activeDocId: docId } : state
  }

  const hasActive = state.activeDocId !== null && state.openDocIds.includes(state.activeDocId)

  // Replace the active tab's slot in place.
  if (!newTab && hasActive) {
    const idx = state.openDocIds.indexOf(state.activeDocId as string)
    const openDocIds = [...state.openDocIds]
    openDocIds[idx] = docId
    return { openDocIds, activeDocId: docId }
  }

  // New tab: insert just after the active tab, else append.
  const insertAt = hasActive
    ? state.openDocIds.indexOf(state.activeDocId as string) + 1
    : state.openDocIds.length
  const openDocIds = [...state.openDocIds]
  openDocIds.splice(insertAt, 0, docId)
  return { openDocIds, activeDocId: activate ? docId : state.activeDocId }
}

export function closeTab(state: TabState, docId: string): TabState {
  const idx = state.openDocIds.indexOf(docId)
  if (idx === -1) return state
  const openDocIds = state.openDocIds.filter((id) => id !== docId)
  const activeDocId =
    state.activeDocId === docId ? pickAfterClose(openDocIds, idx) : state.activeDocId
  return { openDocIds, activeDocId }
}

export function closeOthers(state: TabState, docId: string): TabState {
  if (!state.openDocIds.includes(docId)) return state
  return { openDocIds: [docId], activeDocId: docId }
}

export function closeToRight(state: TabState, docId: string): TabState {
  const idx = state.openDocIds.indexOf(docId)
  if (idx === -1) return state
  const openDocIds = state.openDocIds.slice(0, idx + 1)
  let activeDocId = state.activeDocId
  if (activeDocId && !openDocIds.includes(activeDocId)) {
    // The active tab was to the right and got closed — fall back to the target.
    activeDocId = docId
  }
  return { openDocIds, activeDocId }
}

export function closeAll(): TabState {
  return { ...EMPTY_TAB_STATE }
}

export function activateTab(state: TabState, docId: string): TabState {
  if (!state.openDocIds.includes(docId) || state.activeDocId === docId) return state
  return { ...state, activeDocId: docId }
}

/** Activate the tab at visual index i (Cmd-1…9). Out of range = no-op. */
export function activateByIndex(state: TabState, i: number): TabState {
  if (i < 0 || i >= state.openDocIds.length) return state
  return { ...state, activeDocId: state.openDocIds[i] }
}

/** Cycle the active tab in visual order with wraparound (Ctrl-Tab / Ctrl-Shift-Tab). */
export function cycle(state: TabState, dir: 1 | -1): TabState {
  const n = state.openDocIds.length
  if (n === 0) return state
  const cur = state.activeDocId ? state.openDocIds.indexOf(state.activeDocId) : -1
  const next = (((cur + dir) % n) + n) % n
  return { ...state, activeDocId: state.openDocIds[next] }
}

export function reorderTab(state: TabState, from: number, to: number): TabState {
  const n = state.openDocIds.length
  if (from === to || from < 0 || from >= n || to < 0 || to >= n) return state
  const openDocIds = [...state.openDocIds]
  const [moved] = openDocIds.splice(from, 1)
  openDocIds.splice(to, 0, moved)
  return { openDocIds, activeDocId: state.activeDocId }
}

/**
 * Close every open tab whose doc no longer exists (delete / move-out-of-workspace).
 * If the active tab is dropped, apply the activate-right rule from its old index.
 * Returns the same reference when nothing changed.
 *
 * NOTE: the caller is responsible for the finding-#12 guard (only call this when
 * `documents.list` resolved non-empty), but we also defend against an empty set.
 */
export function reconcileDeletions(state: TabState, existingIds: Set<string>): TabState {
  if (existingIds.size === 0) return state
  const openDocIds = state.openDocIds.filter((id) => existingIds.has(id))
  if (openDocIds.length === state.openDocIds.length) return state

  let activeDocId = state.activeDocId
  if (activeDocId && !existingIds.has(activeDocId)) {
    const oldIdx = state.openDocIds.indexOf(activeDocId)
    activeDocId = pickReconcileActive(state.openDocIds, openDocIds, oldIdx)
  }
  return { openDocIds, activeDocId }
}

function pickReconcileActive(
  oldOrder: string[],
  survivors: string[],
  oldIdx: number
): string | null {
  if (survivors.length === 0) return null
  for (let i = oldIdx + 1; i < oldOrder.length; i++) {
    if (survivors.includes(oldOrder[i])) return oldOrder[i]
  }
  for (let i = oldIdx - 1; i >= 0; i--) {
    if (survivors.includes(oldOrder[i])) return oldOrder[i]
  }
  return survivors[0]
}

/**
 * Decide which tabs stay mounted (keep-mounted LRU). `prev` is the prior mounted
 * set in MRU order. The active tab is always mounted and moved to the front.
 * Beyond `liveCap` we evict from the tail, but NEVER evict the active tab or a
 * tab with an open/deferred conflict — if the whole live set is conflicted we
 * exceed the cap rather than resolve a conflict by silent overwrite.
 */
export function computeMountedIds(
  prev: string[],
  openDocIds: string[],
  activeDocId: string | null,
  liveCap: number,
  isConflicted: (id: string) => boolean
): string[] {
  let next = prev.filter((id) => openDocIds.includes(id))
  if (activeDocId && openDocIds.includes(activeDocId)) {
    next = [activeDocId, ...next.filter((id) => id !== activeDocId)]
  }
  if (next.length <= liveCap) return next

  const result = [...next]
  for (let i = result.length - 1; i >= 0 && result.length > liveCap; i--) {
    const id = result[i]
    if (id === activeDocId) continue
    if (isConflicted(id)) continue
    result.splice(i, 1)
  }
  return result
}
