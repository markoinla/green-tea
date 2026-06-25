import { createContext, useCallback, useContext, useMemo, useState } from 'react'

/**
 * The active note-list metadata filter (Phase 4 human retrieval). Clicking a tag
 * chip or a property value in the Properties block sets this; the left sidebar
 * reads it to restrict the rendered note list and show a clear affordance. There
 * is at most one active filter — picking a new value replaces it.
 */
export interface MetadataFilter {
  workspaceId: string
  key: string
  /** The original (preserve-as-typed) value, shown in the active-filter chip. */
  value: string
}

interface MetadataFilterContextValue {
  filter: MetadataFilter | null
  setFilter: (filter: MetadataFilter) => void
  clearFilter: () => void
}

const MetadataFilterContext = createContext<MetadataFilterContextValue | null>(null)

export function MetadataFilterProvider({ children }: { children: React.ReactNode }) {
  const [filter, setFilterState] = useState<MetadataFilter | null>(null)

  const setFilter = useCallback((next: MetadataFilter) => setFilterState(next), [])
  const clearFilter = useCallback(() => setFilterState(null), [])

  const value = useMemo(
    () => ({ filter, setFilter, clearFilter }),
    [filter, setFilter, clearFilter]
  )

  return <MetadataFilterContext.Provider value={value}>{children}</MetadataFilterContext.Provider>
}

export function useMetadataFilter(): MetadataFilterContextValue {
  const ctx = useContext(MetadataFilterContext)
  if (!ctx) {
    throw new Error('useMetadataFilter must be used within a MetadataFilterProvider')
  }
  return ctx
}
