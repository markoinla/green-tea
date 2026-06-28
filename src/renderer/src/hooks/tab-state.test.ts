import { describe, it, expect } from 'vitest'
import {
  EMPTY_TAB_STATE,
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
  computeMountedIds,
  EMPTY_HISTORY,
  recordNav,
  canNavBack,
  canNavForward,
  pruneNavHistory,
  reconcileNavHistory,
  type TabState,
  type NavHistory
} from './tab-state'

const state = (openDocIds: string[], activeDocId: string | null): TabState => ({
  openDocIds,
  activeDocId
})

describe('openTab', () => {
  it('opens into an empty set as the first active tab', () => {
    expect(openTab(EMPTY_TAB_STATE, 'a')).toEqual(state(['a'], 'a'))
  })

  it('replaces the active tab in place by default (sidebar click)', () => {
    const s = state(['a', 'b', 'c'], 'b')
    expect(openTab(s, 'x')).toEqual(state(['a', 'x', 'c'], 'x'))
  })

  it('opens a new tab right after the active one when newTab is set (Cmd-click)', () => {
    const s = state(['a', 'b', 'c'], 'a')
    expect(openTab(s, 'x', { newTab: true })).toEqual(state(['a', 'x', 'b', 'c'], 'x'))
  })

  it('dedupes — opening an already-open doc just focuses it', () => {
    const s = state(['a', 'b', 'c'], 'a')
    expect(openTab(s, 'c')).toEqual(state(['a', 'b', 'c'], 'c'))
    expect(openTab(s, 'c', { newTab: true })).toEqual(state(['a', 'b', 'c'], 'c'))
  })

  it('honours activate:false when opening a new tab', () => {
    const s = state(['a'], 'a')
    expect(openTab(s, 'b', { newTab: true, activate: false })).toEqual(state(['a', 'b'], 'a'))
  })
})

describe('closeTab', () => {
  it('active rightmost → falls back left', () => {
    const s = state(['a', 'b', 'c'], 'c')
    expect(closeTab(s, 'c')).toEqual(state(['a', 'b'], 'b'))
  })

  it('active middle → activates the tab to the right', () => {
    const s = state(['a', 'b', 'c'], 'b')
    expect(closeTab(s, 'b')).toEqual(state(['a', 'c'], 'c'))
  })

  it('last remaining → empty / null', () => {
    const s = state(['a'], 'a')
    expect(closeTab(s, 'a')).toEqual(state([], null))
  })

  it('closing a background tab does not change the active tab', () => {
    const s = state(['a', 'b', 'c'], 'a')
    expect(closeTab(s, 'c')).toEqual(state(['a', 'b'], 'a'))
  })

  it('no-op when the doc is not open', () => {
    const s = state(['a', 'b'], 'a')
    expect(closeTab(s, 'z')).toBe(s)
  })
})

describe('closeOthers / closeToRight / closeAll', () => {
  it('closeOthers keeps only the target and makes it active', () => {
    const s = state(['a', 'b', 'c'], 'a')
    expect(closeOthers(s, 'b')).toEqual(state(['b'], 'b'))
  })

  it('closeToRight keeps the active tab when it is at/left of the target', () => {
    const s = state(['a', 'b', 'c', 'd'], 'b')
    expect(closeToRight(s, 'b')).toEqual(state(['a', 'b'], 'b'))
  })

  it('closeToRight reassigns active to the target when active was to the right', () => {
    const s = state(['a', 'b', 'c', 'd'], 'd')
    expect(closeToRight(s, 'b')).toEqual(state(['a', 'b'], 'b'))
  })

  it('closeAll empties everything', () => {
    expect(closeAll()).toEqual(state([], null))
  })
})

describe('activate / cycle / reorder', () => {
  it('activateByIndex uses visual order; out of range is a no-op', () => {
    const s = state(['a', 'b', 'c'], 'a')
    expect(activateByIndex(s, 2)).toEqual(state(['a', 'b', 'c'], 'c'))
    expect(activateByIndex(s, 9)).toBe(s)
  })

  it('activateTab focuses an open tab', () => {
    const s = state(['a', 'b'], 'a')
    expect(activateTab(s, 'b')).toEqual(state(['a', 'b'], 'b'))
  })

  it('cycle wraps around in both directions', () => {
    expect(cycle(state(['a', 'b', 'c'], 'c'), 1)).toEqual(state(['a', 'b', 'c'], 'a'))
    expect(cycle(state(['a', 'b', 'c'], 'a'), -1)).toEqual(state(['a', 'b', 'c'], 'c'))
  })

  it('reorderTab moves a tab and preserves the active id', () => {
    const s = state(['a', 'b', 'c'], 'a')
    expect(reorderTab(s, 0, 2)).toEqual(state(['b', 'c', 'a'], 'a'))
  })
})

describe('reconcileDeletions', () => {
  it('drops deleted background tabs without touching the active one', () => {
    const s = state(['a', 'b', 'c'], 'a')
    expect(reconcileDeletions(s, new Set(['a', 'b']))).toEqual(state(['a', 'b'], 'a'))
  })

  it('drops the active tab and activates the right neighbour', () => {
    const s = state(['a', 'b', 'c'], 'b')
    expect(reconcileDeletions(s, new Set(['a', 'c']))).toEqual(state(['a', 'c'], 'c'))
  })

  it('returns the same reference when nothing was removed', () => {
    const s = state(['a', 'b'], 'a')
    expect(reconcileDeletions(s, new Set(['a', 'b']))).toBe(s)
  })

  it('defends against an empty existing-set (suspicious/transient read)', () => {
    const s = state(['a', 'b'], 'a')
    expect(reconcileDeletions(s, new Set())).toBe(s)
  })

  it('exempts file: tabs — never prunes an HTML artifact not in the doc set', () => {
    const s = state(['a', 'file:abc', 'b'], 'a')
    // The doc set lacks file:abc (artifacts live in workspace_files, not documents).
    expect(reconcileDeletions(s, new Set(['a', 'b']))).toBe(s)
  })

  it('keeps a file: tab alive while pruning a deleted doc tab', () => {
    const s = state(['a', 'file:abc', 'b'], 'a')
    expect(reconcileDeletions(s, new Set(['a']))).toEqual(state(['a', 'file:abc'], 'a'))
  })

  it('treats a file: tab as a survivor when the active doc tab is dropped', () => {
    const s = state(['a', 'file:abc'], 'a')
    // `a` no longer exists; the only survivor is the file tab — it must be picked.
    expect(reconcileDeletions(s, new Set(['z']))).toEqual(state(['file:abc'], 'file:abc'))
  })

  it('keeps an active file: tab even when every doc tab is deleted', () => {
    const s = state(['a', 'file:abc', 'b'], 'file:abc')
    expect(reconcileDeletions(s, new Set(['z']))).toEqual(state(['file:abc'], 'file:abc'))
  })
})

describe('navigation history', () => {
  const hist = (stack: string[], index: number): NavHistory => ({ stack, index })

  describe('recordNav', () => {
    it('records the first navigation as the only entry', () => {
      expect(recordNav(EMPTY_HISTORY, 'a')).toEqual(hist(['a'], 0))
    })

    it('appends and advances the index', () => {
      expect(recordNav(hist(['a'], 0), 'b')).toEqual(hist(['a', 'b'], 1))
    })

    it('de-dupes a re-visit of the current entry (returns same reference)', () => {
      const h = hist(['a', 'b'], 1)
      expect(recordNav(h, 'b')).toBe(h)
    })

    it('records a revisit that is not the current entry (e.g. A→B→A)', () => {
      expect(recordNav(hist(['a', 'b'], 1), 'a')).toEqual(hist(['a', 'b', 'a'], 2))
    })

    it('truncates the forward stack when navigating after going back', () => {
      // Trail [a,b,c] sitting back at b, then navigate to x → forward (c) is dropped.
      expect(recordNav(hist(['a', 'b', 'c'], 1), 'x')).toEqual(hist(['a', 'b', 'x'], 2))
    })
  })

  describe('canNavBack / canNavForward', () => {
    it('cannot move from an empty trail', () => {
      expect(canNavBack(EMPTY_HISTORY)).toBe(false)
      expect(canNavForward(EMPTY_HISTORY)).toBe(false)
    })

    it('cannot go back from the first entry', () => {
      expect(canNavBack(hist(['a'], 0))).toBe(false)
    })

    it('can go back but not forward at the end of the trail', () => {
      expect(canNavBack(hist(['a', 'b'], 1))).toBe(true)
      expect(canNavForward(hist(['a', 'b'], 1))).toBe(false)
    })

    it('can go forward when sitting before the end', () => {
      expect(canNavForward(hist(['a', 'b'], 0))).toBe(true)
    })
  })

  describe('pruneNavHistory', () => {
    const keepAll = (): boolean => true

    it('returns the same reference when nothing is removed', () => {
      const h = hist(['a', 'b', 'c'], 2)
      expect(pruneNavHistory(h, keepAll)).toBe(h)
    })

    it('drops a deleted background entry and shifts the index back', () => {
      // Remove `a` (before the cursor); cursor stays on `c`.
      expect(pruneNavHistory(hist(['a', 'b', 'c'], 2), (id) => id !== 'a')).toEqual(
        hist(['b', 'c'], 1)
      )
    })

    it('does not shift the index for an entry removed after the cursor', () => {
      expect(pruneNavHistory(hist(['a', 'b', 'c'], 0), (id) => id !== 'c')).toEqual(
        hist(['a', 'b'], 0)
      )
    })

    it('clamps the cursor onto a survivor when the current entry is removed', () => {
      expect(pruneNavHistory(hist(['a', 'b', 'c'], 1), (id) => id !== 'b')).toEqual(
        hist(['a', 'c'], 0)
      )
    })

    it('collapses consecutive duplicates created by a removal', () => {
      // Removing `b` from [a,b,a] would leave [a,a]; collapse to [a].
      expect(pruneNavHistory(hist(['a', 'b', 'a'], 2), (id) => id !== 'b')).toEqual(hist(['a'], 0))
    })

    it('empties the trail when every entry is removed', () => {
      expect(pruneNavHistory(hist(['a', 'b'], 1), () => false)).toEqual(hist([], -1))
    })
  })

  describe('reconcileNavHistory', () => {
    const keepAll = (): boolean => true

    it('parks the cursor on the survivor that becomes active, preserving forward', () => {
      // Repro: trail [a,b,c,d] sitting back at b; note b is deleted and the tab
      // reducer re-activates c (its right neighbour). The cursor must land on c so
      // d stays Forward-reachable instead of being truncated.
      const h = hist(['a', 'b', 'c', 'd'], 1)
      const out = reconcileNavHistory(h, (id) => id !== 'b', 'c')
      expect(out).toEqual(hist(['a', 'c', 'd'], 1))
      expect(canNavForward(out)).toBe(true)
    })

    it('falls back to the plain prune when the new active is not in the trail', () => {
      const h = hist(['a', 'b', 'c'], 2)
      // `x` was never a recorded navigation — leave the clamped prune as-is.
      expect(reconcileNavHistory(h, (id) => id !== 'b', 'x')).toEqual(hist(['a', 'c'], 1))
    })

    it('leaves the cursor put when the new active is already the current entry', () => {
      const h = hist(['a', 'b', 'c'], 2)
      expect(reconcileNavHistory(h, keepAll, 'c')).toBe(h)
    })

    it('handles a null active (no tabs left) as a plain prune', () => {
      expect(reconcileNavHistory(hist(['a', 'b'], 1), () => false, null)).toEqual(hist([], -1))
    })
  })
})

describe('computeMountedIds (LRU eviction)', () => {
  const noConflict = (): boolean => false

  it('moves the active tab to the front and keeps within cap', () => {
    expect(computeMountedIds(['a', 'b'], ['a', 'b', 'c'], 'c', 8, noConflict)).toEqual([
      'c',
      'a',
      'b'
    ])
  })

  it('evicts clean tabs from the tail beyond the cap', () => {
    const result = computeMountedIds(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 2, noConflict)
    expect(result).toEqual(['a', 'b'])
  })

  it('prunes tabs no longer open', () => {
    expect(computeMountedIds(['a', 'b', 'c'], ['a', 'c'], 'a', 8, noConflict)).toEqual(['a', 'c'])
  })

  it('INVARIANT: never evicts a conflicted tab — exceeds the cap instead', () => {
    const isConflicted = (id: string): boolean => id === 'c'
    // cap 1, active a, c conflicted: b is evicted, but c is protected so the set
    // stays at [a, c] (length 2 > cap) rather than overwriting c's conflict.
    const result = computeMountedIds(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 1, isConflicted)
    expect(result).toContain('a')
    expect(result).toContain('c')
    expect(result).not.toContain('b')
  })

  it('INVARIANT: when the whole live set is conflicted it exceeds the cap', () => {
    const allConflicted = (): boolean => true
    const result = computeMountedIds(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 1, allConflicted)
    expect(result.sort()).toEqual(['a', 'b', 'c'])
  })
})
