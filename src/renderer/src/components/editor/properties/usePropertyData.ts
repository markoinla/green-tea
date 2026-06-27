import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Document } from '../../../../../main/database/types'
import type { PropertyType } from '../../../../../main/vault/metadata'
import { useMetadataFilter } from '@renderer/contexts/MetadataFilterContext'
import { buildPropertyRows, defaultValueForType, type PropertyRow } from './properties-model'

export interface PropertyData {
  /** Editable user properties (reserved keys excluded). */
  rows: PropertyRow[]
  /** Keys already in use, for validating new property names. */
  existingKeys: string[]
  /** Raw frontmatter, used to render the readonly reserved rows. */
  frontmatter: Record<string, unknown>
  workspaceId: string
  /** Field-merge write: a single changed key (null clears it on the main side). */
  writeKey: (key: string, value: unknown) => void
  setType: (key: string, type: PropertyType) => void
  addProperty: (key: string, type: PropertyType) => void
  filterByValue: (key: string, value: string) => void
  tagSuggest: (prefix: string) => Promise<string[]>
}

/**
 * Encapsulates everything the Properties panel needs: the type registry, the
 * derived rows, and the writers. Lifted out of the panel so the facet bar can
 * read `rows.length` for the pill count without re-fetching.
 */
export function usePropertyData(doc: Document): PropertyData {
  const [types, setTypes] = useState<{ key: string; type: PropertyType }[]>([])
  const workspaceId = doc.workspace_id
  const frontmatter = useMemo(() => doc.frontmatter ?? {}, [doc.frontmatter])
  const { setFilter } = useMetadataFilter()

  const refreshTypes = useCallback(() => {
    if (!workspaceId) return
    window.api.metadata.getTypes(workspaceId).then(setTypes)
  }, [workspaceId])

  useEffect(() => {
    refreshTypes()
  }, [refreshTypes, doc.frontmatter])

  const rows = useMemo(() => buildPropertyRows(frontmatter, types), [frontmatter, types])
  const existingKeys = useMemo(() => rows.map((r) => r.key), [rows])

  const writeKey = useCallback(
    (key: string, value: unknown) => {
      window.api.documents.updateFrontmatter(doc.id, { [key]: value })
    },
    [doc.id]
  )

  const setType = useCallback(
    (key: string, type: PropertyType) => {
      if (!workspaceId) return
      window.api.metadata.setType(workspaceId, key, type).then(refreshTypes)
    },
    [workspaceId, refreshTypes]
  )

  const addProperty = useCallback(
    (key: string, type: PropertyType) => {
      if (type !== 'text') setType(key, type)
      writeKey(key, defaultValueForType(type))
    },
    [setType, writeKey]
  )

  // Click a tag chip / property value -> filter the note list. The value is
  // passed as-typed; the main side folds it for the case-insensitive match.
  const filterByValue = useCallback(
    (key: string, value: string) => {
      if (!workspaceId || value.length === 0) return
      setFilter({ workspaceId, key, value })
    },
    [workspaceId, setFilter]
  )

  const tagSuggest = useCallback(
    (prefix: string) => window.api.metadata.tagSuggest(workspaceId, prefix),
    [workspaceId]
  )

  return {
    rows,
    existingKeys,
    frontmatter,
    workspaceId,
    writeKey,
    setType,
    addProperty,
    filterByValue,
    tagSuggest
  }
}
