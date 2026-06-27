import { useCallback, useEffect, useState } from 'react'
import { SlidersHorizontal, Link2 } from 'lucide-react'
import type { Document } from '../../../../main/database/types'
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { usePropertyData } from './properties/usePropertyData'
import { PropertiesPanel } from './properties/PropertiesPanel'
import { useBacklinks } from './backlinks/useBacklinks'
import { BacklinksPanel } from './backlinks/BacklinksPanel'

// Which facet tab is selected lives in the global `settings` table (a UI
// preference, never written to the .md file) so it persists and stays in sync
// across open tabs.
const ACTIVE_FACET_KEY = 'noteFacetActive'
type Facet = 'properties' | 'links'
/** '' means every panel is collapsed. */
type OpenFacet = Facet | ''

interface NoteFacetBarProps {
  document: Document
  /** Navigate to a document when a backlink is clicked. */
  onNavigateToDoc?: (docId: string) => void
}

/**
 * The tab strip shown beneath a note's title bar. Each tab shows an inline panel
 * below it (Properties, Linked references); the tabs carry counts so you can see
 * what a note has at a glance, the panel holds the actual content.
 */
export function NoteFacetBar({ document: doc, onNavigateToDoc }: NoteFacetBarProps) {
  const propertyData = usePropertyData(doc)
  const backlinks = useBacklinks(doc.id)
  const hasBacklinks = backlinks.length > 0

  const [active, setActive] = useFacetPreference(ACTIVE_FACET_KEY, 'properties')

  // The Links tab only exists when there are backlinks; collapse if it was the
  // persisted choice but this note has none.
  const effectiveActive: OpenFacet = active === 'links' && !hasBacklinks ? '' : active

  // We drive open/close entirely from onClick (clicking the active tab collapses
  // everything) and neutralize Radix's own activation with a no-op onValueChange,
  // so its click handling can't reopen what we just closed.
  const toggle = (facet: Facet) => setActive(effectiveActive === facet ? '' : facet)

  return (
    <div className="shrink-0 border-b border-border/60 bg-background">
      {/* Left-aligned to the editor pane (not the centered note column). */}
      <div className="px-3">
        <Tabs value={effectiveActive} onValueChange={() => {}} className="gap-0">
          <TabsList variant="line" className="h-9 gap-3">
            <TabsTrigger value="properties" onClick={() => toggle('properties')}>
              <SlidersHorizontal />
              Properties
              {propertyData.rows.length > 0 && <FacetCount n={propertyData.rows.length} />}
            </TabsTrigger>
            {/* Hidden until the note has references, keeping clean notes uncluttered. */}
            {hasBacklinks && (
              <TabsTrigger value="links" onClick={() => toggle('links')}>
                <Link2 />
                Links
                <FacetCount n={backlinks.length} />
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>

        {/* The open panel pushes the editor down (inline) but is capped so a long
            list scrolls within the bar instead of swallowing the editor. */}
        {effectiveActive !== '' && (
          <div className="max-h-[40vh] overflow-auto pb-3 pt-2">
            {effectiveActive === 'properties' && <PropertiesPanel data={propertyData} />}
            {effectiveActive === 'links' && (
              <BacklinksPanel backlinks={backlinks} onNavigateToDoc={onNavigateToDoc} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function FacetCount({ n }: { n: number }) {
  return <span className="text-muted-foreground/70 tabular-nums font-normal">{n}</span>
}

/**
 * A string preference backed by the global `settings` table, kept in sync across
 * editor instances via the settings-changed broadcast. Returns `[value, set]`.
 */
function useFacetPreference(
  key: string,
  defaultValue: OpenFacet
): readonly [OpenFacet, (next: OpenFacet) => void] {
  const [value, setValue] = useState<OpenFacet>(defaultValue)

  useEffect(() => {
    let active = true
    window.api.settings.get(key).then((v) => {
      if (active && v !== null) setValue(v as OpenFacet)
    })
    const unsub = window.api.onSettingsChanged(() => {
      window.api.settings.get(key).then((v) => {
        if (v !== null) setValue(v as OpenFacet)
      })
    })
    return () => {
      active = false
      unsub()
    }
  }, [key])

  const set = useCallback(
    (next: OpenFacet) => {
      setValue(next)
      window.api.settings.set(key, next)
    },
    [key]
  )

  return [value, set] as const
}
