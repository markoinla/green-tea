import { describe, it, expect, vi } from 'vitest'
import { createDocumentsStore } from './useDocuments'
import type { Document } from '../../../main/database/types'

function doc(id: string, workspaceId?: string): Document {
  return { id, title: id, workspace_id: workspaceId ?? null } as unknown as Document
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

interface Harness {
  store: ReturnType<typeof createDocumentsStore>
  list: ReturnType<typeof vi.fn>
  fireChanged: () => void
  onChangedCount: () => number
  offChangedCount: () => number
}

function makeHarness(listImpl?: (workspaceId?: string) => Promise<Document[]>): Harness {
  const changedCallbacks = new Set<() => void>()
  let subscribes = 0
  let unsubscribes = 0
  const list = vi.fn(
    listImpl ?? ((workspaceId?: string) => Promise.resolve([doc('a', workspaceId)]))
  )
  const store = createDocumentsStore({
    list,
    onChanged: (cb) => {
      subscribes++
      changedCallbacks.add(cb)
      return () => {
        unsubscribes++
        changedCallbacks.delete(cb)
      }
    }
  })
  return {
    store,
    list,
    fireChanged: () => {
      for (const cb of changedCallbacks) cb()
    },
    onChangedCount: () => subscribes,
    offChangedCount: () => unsubscribes
  }
}

describe('createDocumentsStore', () => {
  it('fetches once when multiple subscribers mount on the same workspace', async () => {
    const h = makeHarness()
    const ws = h.store.getStore('ws1')
    const unsubs = [1, 2, 3, 4, 5].map(() => h.store.subscribe(ws, () => {}))
    await flushMicrotasks()
    expect(h.list).toHaveBeenCalledTimes(1)
    expect(h.list).toHaveBeenCalledWith('ws1')
    unsubs.forEach((u) => u())
  })

  it('attaches one IPC subscription on first mount and detaches on last unmount', () => {
    const h = makeHarness()
    const ws = h.store.getStore('ws1')
    const u1 = h.store.subscribe(ws, () => {})
    const u2 = h.store.subscribe(ws, () => {})
    expect(h.onChangedCount()).toBe(1)
    u1()
    expect(h.offChangedCount()).toBe(0)
    u2()
    expect(h.offChangedCount()).toBe(1)
    // double-unsubscribe must not corrupt the refcount
    u2()
    const u3 = h.store.subscribe(ws, () => {})
    expect(h.onChangedCount()).toBe(2)
    u3()
    expect(h.offChangedCount()).toBe(2)
  })

  it('coalesces a burst of change events into a bounded number of fetches', async () => {
    const h = makeHarness()
    const ws = h.store.getStore('ws1')
    const unsub = h.store.subscribe(ws, () => {})
    await flushMicrotasks()
    h.list.mockClear()
    for (let i = 0; i < 10; i++) h.fireChanged()
    await flushMicrotasks()
    await flushMicrotasks()
    // same-tick events collapse to one microtask pass → one fetch
    expect(h.list).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('dedupes concurrent refreshes into one shared queued follow-up', async () => {
    let resolveFirst!: (docs: Document[]) => void
    const results: Array<(docs: Document[]) => void> = []
    const h = makeHarness(
      () =>
        new Promise<Document[]>((resolve) => {
          results.push(resolve)
          if (results.length === 1) resolveFirst = resolve
        })
    )
    const ws = h.store.getStore('ws1')
    const unsub = h.store.subscribe(ws, () => {})
    // three refreshes while the mount fetch is in flight share one follow-up
    const p1 = h.store.refresh(ws)
    const p2 = h.store.refresh(ws)
    const p3 = h.store.refresh(ws)
    resolveFirst([doc('stale')])
    await flushMicrotasks()
    expect(results.length).toBe(2)
    results[1]([doc('fresh')])
    await Promise.all([p1, p2, p3])
    expect(h.list).toHaveBeenCalledTimes(2)
    expect(ws.documents.map((d) => d.id)).toEqual(['fresh'])
    unsub()
  })

  it('keeps workspace caches independent and only refetches subscribed workspaces', async () => {
    const h = makeHarness((workspaceId) =>
      Promise.resolve([doc(`doc-${workspaceId}`, workspaceId)])
    )
    const ws1 = h.store.getStore('ws1')
    const ws2 = h.store.getStore('ws2')
    const u1 = h.store.subscribe(ws1, () => {})
    const u2 = h.store.subscribe(ws2, () => {})
    await flushMicrotasks()
    expect(ws1.documents[0].id).toBe('doc-ws1')
    expect(ws2.documents[0].id).toBe('doc-ws2')
    u2()
    h.list.mockClear()
    h.fireChanged()
    await flushMicrotasks()
    expect(h.list).toHaveBeenCalledTimes(1)
    expect(h.list).toHaveBeenCalledWith('ws1')
    u1()
  })

  it('treats undefined and null workspace ids as the same store', () => {
    const h = makeHarness()
    expect(h.store.getStore(undefined)).toBe(h.store.getStore(null))
    expect(h.store.getStore('ws1')).not.toBe(h.store.getStore(null))
  })

  it('shows loading only for the first load, not for event-driven revalidation', async () => {
    const h = makeHarness()
    const ws = h.store.getStore('ws1')
    expect(h.store.getSnapshot(ws).loading).toBe(true)
    const unsub = h.store.subscribe(ws, () => {})
    await flushMicrotasks()
    expect(h.store.getSnapshot(ws).loading).toBe(false)
    h.fireChanged()
    expect(h.store.getSnapshot(ws).loading).toBe(false)
    await flushMicrotasks()
    expect(h.store.getSnapshot(ws).loading).toBe(false)
    unsub()
  })

  it('returns a referentially stable snapshot between changes', async () => {
    const h = makeHarness()
    const ws = h.store.getStore('ws1')
    const unsub = h.store.subscribe(ws, () => {})
    await flushMicrotasks()
    const snap1 = h.store.getSnapshot(ws)
    const snap2 = h.store.getSnapshot(ws)
    expect(snap1).toBe(snap2)
    await h.store.refresh(ws)
    expect(h.store.getSnapshot(ws)).not.toBe(snap1)
    unsub()
  })

  it('notifies subscribers when documents change', async () => {
    const h = makeHarness()
    const ws = h.store.getStore('ws1')
    const listener = vi.fn()
    const unsub = h.store.subscribe(ws, listener)
    await flushMicrotasks()
    expect(listener).toHaveBeenCalled()
    listener.mockClear()
    h.fireChanged()
    await flushMicrotasks()
    expect(listener).toHaveBeenCalled()
    unsub()
  })

  it('revalidates when a workspace regains its first subscriber after a gap', async () => {
    const h = makeHarness()
    const ws = h.store.getStore('ws1')
    const u1 = h.store.subscribe(ws, () => {})
    await flushMicrotasks()
    u1()
    h.list.mockClear()
    const u2 = h.store.subscribe(ws, () => {})
    await flushMicrotasks()
    expect(h.list).toHaveBeenCalledTimes(1)
    u2()
  })

  it('recovers loading state after a failed first load', async () => {
    let fail = true
    const h = makeHarness(() =>
      fail ? Promise.reject(new Error('boom')) : Promise.resolve([doc('a')])
    )
    const ws = h.store.getStore('ws1')
    await expect(h.store.refresh(ws)).rejects.toThrow('boom')
    expect(h.store.getSnapshot(ws).loading).toBe(false)
    expect(ws.loaded).toBe(false)
    fail = false
    const p = h.store.refresh(ws)
    // retry of a never-loaded workspace shows loading again
    expect(h.store.getSnapshot(ws).loading).toBe(true)
    await p
    expect(h.store.getSnapshot(ws).loading).toBe(false)
    expect(ws.documents.map((d) => d.id)).toEqual(['a'])
  })
})
