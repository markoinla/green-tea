import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { SlidersHorizontal, Link2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Editor } from '@tiptap/react'
import type { Document } from '../../../../main/database/types'
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { usePropertyData } from './properties/usePropertyData'
import { PropertiesPanel } from './properties/PropertiesPanel'
import { useBacklinks } from './backlinks/useBacklinks'
import { useOutgoingLinks } from './backlinks/useOutgoingLinks'
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
  /** The note's editor, used to derive the live word count. */
  editor: Editor | null
  /** Navigate to a document when a backlink is clicked. */
  onNavigateToDoc?: (docId: string, opts?: { newTab?: boolean }) => void
  /** Step back/forward through the notes viewed in this pane (global view trail). */
  onNavigateBack?: () => void
  onNavigateForward?: () => void
  canNavigateBack?: boolean
  canNavigateForward?: boolean
}

/**
 * The tab strip shown beneath a note's title bar. Each tab shows an inline panel
 * below it (Properties, Linked references); the tabs carry counts so you can see
 * what a note has at a glance, the panel holds the actual content.
 */
export function NoteFacetBar({
  document: doc,
  editor,
  onNavigateToDoc,
  onNavigateBack,
  onNavigateForward,
  canNavigateBack = false,
  canNavigateForward = false
}: NoteFacetBarProps) {
  const propertyData = usePropertyData(doc)
  const backlinks = useBacklinks(doc.id)
  const outgoingLinks = useOutgoingLinks(doc.id)
  const linkCount = backlinks.length + outgoingLinks.length
  const wordCount = useWordCount(editor, doc.id)

  const [active, setActive] = useFacetPreference(ACTIVE_FACET_KEY, 'properties')

  // We drive open/close entirely from onClick (clicking the active tab collapses
  // everything) and neutralize Radix's own activation with a no-op onValueChange,
  // so its click handling can't reopen what we just closed.
  const toggle = (facet: Facet) => setActive(active === facet ? '' : facet)

  return (
    <div className="shrink-0 border-b border-border/60 bg-background">
      {/* Left-aligned to the editor pane (not the centered note column). */}
      <div className="px-3">
        {/* Back/forward + tabs on the left, word count pinned to the right. */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <NavButtons
              onBack={onNavigateBack}
              onForward={onNavigateForward}
              canBack={canNavigateBack}
              canForward={canNavigateForward}
            />
            <Tabs value={active} onValueChange={() => {}} className="gap-0">
              <TabsList variant="line" className="h-9 gap-3">
                <TabsTrigger value="properties" onClick={() => toggle('properties')}>
                  <SlidersHorizontal />
                  Properties
                  {propertyData.rows.length > 0 && <FacetCount n={propertyData.rows.length} />}
                </TabsTrigger>
                <TabsTrigger value="links" onClick={() => toggle('links')}>
                  <Link2 />
                  Links
                  {linkCount > 0 && <FacetCount n={linkCount} />}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <span className="text-xs text-muted-foreground/70 tabular-nums">
            {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
          </span>
        </div>

        {/* The open panel pushes the editor down (inline) but is capped so a long
            list scrolls within the bar instead of swallowing the editor. */}
        {active !== '' && (
          <div className="max-h-[40vh] overflow-auto pb-3 pt-2">
            {active === 'properties' && <PropertiesPanel data={propertyData} />}
            {active === 'links' && (
              <BacklinksPanel
                backlinks={backlinks}
                outgoingLinks={outgoingLinks}
                onNavigateToDoc={onNavigateToDoc}
              />
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
 * Browser-style back/forward buttons for the notes viewed in this pane. Both are
 * always rendered (no layout shift); the one with nowhere to go is disabled.
 */
function NavButtons({
  onBack,
  onForward,
  canBack,
  canForward
}: {
  onBack?: () => void
  onForward?: () => void
  canBack: boolean
  canForward: boolean
}) {
  return (
    <div className="flex items-center -ml-1">
      <NavButton label="Back" onClick={onBack} disabled={!canBack}>
        <ChevronLeft className="h-4 w-4" />
      </NavButton>
      <NavButton label="Forward" onClick={onForward} disabled={!canForward}>
        <ChevronRight className="h-4 w-4" />
      </NavButton>
    </div>
  )
}

function NavButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick?: () => void
  disabled: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}

/** Count whitespace-separated tokens in the editor's plain text. */
function countWords(text: string): number {
  const tokens = text.trim().match(/\S+/g)
  return tokens ? tokens.length : 0
}

/**
 * Live word count for the editor's text. Recomputes on every edit, and on
 * document switch — the editor swaps content with `emitUpdate: false`, so the
 * `docId` dependency is what re-reads the new note's text.
 */
function useWordCount(editor: Editor | null, docId: string): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!editor) {
      setCount(0)
      return
    }
    const update = () => setCount(countWords(editor.getText()))
    update()
    editor.on('update', update)
    return () => {
      editor.off('update', update)
    }
  }, [editor, docId])

  return count
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
