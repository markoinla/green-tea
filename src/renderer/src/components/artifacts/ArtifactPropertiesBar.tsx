import { useCallback, useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { Document } from '../../../../main/database/types'
import { useDocument } from '@renderer/hooks/useDocument'
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { usePropertyData } from '../editor/properties/usePropertyData'
import { PropertiesPanel } from '../editor/properties/PropertiesPanel'

// Mirrors NoteFacetBar's open/close preference so the Properties panel state is
// shared across notes and artifacts (one UI surface, one preference key).
const ACTIVE_FACET_KEY = 'noteFacetActive'

/**
 * The Properties strip shown above a non-note artifact viewer. Artifacts have no
 * frontmatter (their bytes can't hold YAML), so their user-authored properties
 * live in SQLite (`artifact_properties`) and are surfaced through `doc.frontmatter`
 * by `getDocument`. This reuses the SAME Properties UI notes use — only the
 * note-specific facets (links, word count) are dropped.
 */
export function ArtifactPropertiesBar({ doc }: { doc: Document }) {
  // The tab list row carries no frontmatter for artifacts; re-read via getDocument
  // (which folds `artifact_properties` into `frontmatter`) so the panel sees the
  // live values, and refreshes on the `documents:changed` broadcast each write fires.
  const { document } = useDocument(doc.id)
  const propertyData = usePropertyData(document ?? doc)
  const [open, setOpen] = useFacetOpen(ACTIVE_FACET_KEY)

  return (
    <div className="shrink-0 border-b border-border/60 bg-background">
      <div className="px-3">
        <Tabs value={open ? 'properties' : ''} onValueChange={() => {}} className="gap-0">
          <TabsList variant="line" className="h-9 gap-3">
            <TabsTrigger value="properties" onClick={() => setOpen(!open)}>
              <SlidersHorizontal />
              Properties
              {propertyData.rows.length > 0 && (
                <span className="text-muted-foreground/70 tabular-nums font-normal">
                  {propertyData.rows.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {open && (
          <div className="max-h-[40vh] overflow-auto pb-3 pt-2">
            <PropertiesPanel data={propertyData} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Whether the Properties panel is open, backed by the global `settings` table and
 * kept in sync across editor instances. The stored value is the active facet name
 * ('properties' | 'links' | ''); here we only care whether it's 'properties'.
 */
function useFacetOpen(key: string): readonly [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let active = true
    window.api.settings.get(key).then((v) => {
      if (active && v !== null) setOpen(v === 'properties')
    })
    const unsub = window.api.onSettingsChanged(() => {
      window.api.settings.get(key).then((v) => {
        if (v !== null) setOpen(v === 'properties')
      })
    })
    return () => {
      active = false
      unsub()
    }
  }, [key])

  const set = useCallback(
    (next: boolean) => {
      setOpen(next)
      window.api.settings.set(key, next ? 'properties' : '')
    },
    [key]
  )

  return [open, set] as const
}
