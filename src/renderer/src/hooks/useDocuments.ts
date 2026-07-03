import { useCallback, useSyncExternalStore } from 'react'
import type { Document, DocumentKind } from '../../../main/database/types'

interface UseDocumentsResult {
  documents: Document[]
  loading: boolean
  createDocument: (data: {
    title: string
    workspace_id?: string
    folder_id?: string | null
  }) => Promise<Document>
  createArtifact: (data: {
    title: string
    kind: DocumentKind
    workspace_id?: string
    folder_id?: string | null
  }) => Promise<Document>
  updateDocument: (
    id: string,
    data: {
      title?: string
      workspace_id?: string
      content?: string
      folder_id?: string | null
    }
  ) => Promise<Document>
  updateFrontmatter: (
    id: string,
    changedKeys: Record<string, unknown>
  ) => Promise<{ document: Document; rejectedKeys: string[] }>
  deleteDocument: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

// The hook is mounted by several components at once (sidebars, tab strip,
// editor host). Without sharing, every documents:changed event triggered one
// full documents.list() per instance — an agent turn writing N notes meant 5N+
// IPC round trips. This module-level store keeps one cached list per workspace,
// one IPC subscription (refcounted across all instances) and one deduped
// refetch, with per-instance useSyncExternalStore fan-out for re-renders.

interface DocumentsSnapshot {
  documents: Document[]
  loading: boolean
}

interface WorkspaceStore {
  wsId: string | undefined
  documents: Document[]
  loading: boolean
  loaded: boolean
  inFlight: Promise<void> | null
  queued: Promise<void> | null
  snapshot: DocumentsSnapshot | null
  listeners: Set<() => void>
}

interface DocumentsStoreApi {
  list: (workspaceId?: string) => Promise<Document[]>
  onChanged: (callback: () => void) => () => void
}

// Exported for tests; the app uses the lazy singleton below.
export function createDocumentsStore(api: DocumentsStoreApi): {
  getStore: (workspaceId?: string | null) => WorkspaceStore
  subscribe: (store: WorkspaceStore, listener: () => void) => () => void
  refresh: (store: WorkspaceStore) => Promise<void>
  getSnapshot: (store: WorkspaceStore) => DocumentsSnapshot
} {
  // Keyed by workspace so a fetch for one workspace can never clobber
  // another's cache, and a workspace switch gets its own loading state.
  const stores = new Map<string | null, WorkspaceStore>()
  let totalSubscribers = 0
  let unsubscribeIpc: (() => void) | null = null
  let refetchScheduled = false

  function getStore(workspaceId?: string | null): WorkspaceStore {
    const key = workspaceId ?? null
    let store = stores.get(key)
    if (!store) {
      store = {
        wsId: workspaceId ?? undefined,
        documents: [],
        loading: true,
        loaded: false,
        inFlight: null,
        queued: null,
        snapshot: null,
        listeners: new Set()
      }
      stores.set(key, store)
    }
    return store
  }

  function emit(store: WorkspaceStore): void {
    store.snapshot = null
    for (const listener of store.listeners) listener()
  }

  function refresh(store: WorkspaceStore): Promise<void> {
    // Dedupe: while a fetch is in flight, all callers share one queued
    // follow-up fetch — mutations awaiting refresh() still observe data read
    // at-or-after their write, without a fetch per caller.
    if (store.inFlight) {
      if (!store.queued) {
        store.queued = store.inFlight
          .catch(() => {})
          .then(() => {
            store.queued = null
            return refresh(store)
          })
      }
      return store.queued
    }
    // Only the very first load of a workspace shows the loading state.
    // Event/mutation-driven refreshes revalidate in the background while the
    // existing list stays on screen — otherwise a refetch blanks the note
    // tree to a "Loading…" placeholder and flashes on every change.
    if (!store.loaded && !store.loading) {
      store.loading = true
      emit(store)
    }
    store.inFlight = (async () => {
      try {
        const docs = await api.list(store.wsId)
        store.documents = docs
        store.loaded = true
      } finally {
        store.inFlight = null
        store.loading = false
        emit(store)
      }
    })()
    return store.inFlight
  }

  function scheduleRefetchAll(): void {
    // Microtask-coalesce bursts of same-tick change events into one pass.
    if (refetchScheduled) return
    refetchScheduled = true
    queueMicrotask(() => {
      refetchScheduled = false
      for (const store of stores.values()) {
        if (store.listeners.size > 0) void refresh(store).catch(() => {})
      }
    })
  }

  function subscribe(store: WorkspaceStore, listener: () => void): () => void {
    if (totalSubscribers === 0) {
      unsubscribeIpc = api.onChanged(scheduleRefetchAll)
    }
    totalSubscribers++
    const firstForStore = store.listeners.size === 0
    store.listeners.add(listener)
    if (firstForStore) {
      // Fresh mount, or remount after a gap with no listeners (change events
      // are skipped for unwatched workspaces) — revalidate the cache.
      void refresh(store).catch(() => {})
    }
    let active = true
    return () => {
      if (!active) return
      active = false
      store.listeners.delete(listener)
      totalSubscribers--
      if (totalSubscribers === 0 && unsubscribeIpc) {
        unsubscribeIpc()
        unsubscribeIpc = null
      }
    }
  }

  function getSnapshot(store: WorkspaceStore): DocumentsSnapshot {
    if (!store.snapshot) {
      store.snapshot = { documents: store.documents, loading: store.loading }
    }
    return store.snapshot
  }

  return { getStore, subscribe, refresh, getSnapshot }
}

let sharedStore: ReturnType<typeof createDocumentsStore> | null = null

function getSharedStore(): ReturnType<typeof createDocumentsStore> {
  if (!sharedStore) {
    sharedStore = createDocumentsStore({
      list: (workspaceId) => window.api.documents.list(workspaceId),
      onChanged: (callback) => window.api.onDocumentsChanged(callback)
    })
  }
  return sharedStore
}

export function useDocuments(workspaceId?: string | null): UseDocumentsResult {
  const shared = getSharedStore()
  const store = shared.getStore(workspaceId)

  const subscribe = useCallback(
    (listener: () => void) => shared.subscribe(store, listener),
    [shared, store]
  )
  const { documents, loading } = useSyncExternalStore(subscribe, () => shared.getSnapshot(store))

  const refresh = useCallback(() => shared.refresh(store), [shared, store])

  const createDocument = useCallback(
    async (data: { title: string; workspace_id?: string; folder_id?: string | null }) => {
      const doc = await window.api.documents.create({
        ...data,
        workspace_id: data.workspace_id ?? workspaceId ?? undefined
      })
      await refresh()
      return doc
    },
    [refresh, workspaceId]
  )

  const createArtifact = useCallback(
    async (data: {
      title: string
      kind: DocumentKind
      workspace_id?: string
      folder_id?: string | null
    }) => {
      const doc = await window.api.documents.createArtifact({
        ...data,
        workspace_id: data.workspace_id ?? workspaceId ?? undefined
      })
      await refresh()
      return doc
    },
    [refresh, workspaceId]
  )

  const updateDocument = useCallback(
    async (
      id: string,
      data: { title?: string; workspace_id?: string; content?: string; folder_id?: string | null }
    ) => {
      const doc = await window.api.documents.update(id, data)
      await refresh()
      return doc
    },
    [refresh]
  )

  const updateFrontmatter = useCallback(
    async (id: string, changedKeys: Record<string, unknown>) => {
      const result = await window.api.documents.updateFrontmatter(id, changedKeys)
      await refresh()
      return result
    },
    [refresh]
  )

  const deleteDocument = useCallback(
    async (id: string) => {
      await window.api.documents.delete(id)
      await refresh()
    },
    [refresh]
  )

  return {
    documents,
    loading,
    createDocument,
    createArtifact,
    updateDocument,
    updateFrontmatter,
    deleteDocument,
    refresh
  }
}
