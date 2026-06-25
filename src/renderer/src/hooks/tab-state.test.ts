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
  type TabState
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
