import type { Backlink, OutgoingLink } from '../../../../../main/vault/documents-service'

interface BacklinksPanelProps {
  /** Notes that link to the current note. */
  backlinks: Backlink[]
  /** Notes the current note links out to. */
  outgoingLinks: OutgoingLink[]
  /** Open a note when one of its rows is clicked (Cmd/Ctrl-click → new tab). */
  onNavigateToDoc?: (docId: string, opts?: { newTab?: boolean }) => void
}

/**
 * The Links panel rendered inside the note facet bar. Shows two sections: the
 * note's own outgoing links and the incoming "linked references". The facet bar
 * mounts this even when both are empty, so each section carries its own empty
 * state.
 */
export function BacklinksPanel({ backlinks, outgoingLinks, onNavigateToDoc }: BacklinksPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <LinkSection title="Links from this note">
        {outgoingLinks.length === 0 ? (
          <EmptyState>No links in this note.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1">
            {outgoingLinks.map((link, i) => (
              <LinkRow
                // Broken links share id=null, so fall back to title+index for the key.
                key={link.id ?? `${link.title}-${i}`}
                title={link.title}
                snippet={link.snippet}
                docId={link.id}
                onNavigateToDoc={onNavigateToDoc}
              />
            ))}
          </ul>
        )}
      </LinkSection>

      <LinkSection title="Linked references">
        {backlinks.length === 0 ? (
          <EmptyState>No notes link here yet.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1">
            {backlinks.map((link) => (
              <LinkRow
                key={link.id}
                title={link.title}
                snippet={link.snippet}
                docId={link.id}
                onNavigateToDoc={onNavigateToDoc}
              />
            ))}
          </ul>
        )}
      </LinkSection>
    </div>
  )
}

function LinkSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
        {title}
      </div>
      {children}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1 text-xs text-muted-foreground/60">{children}</div>
}

interface LinkRowProps {
  title: string
  snippet: string
  /** null for a broken outgoing link — rendered as non-clickable. */
  docId: string | null
  onNavigateToDoc?: (docId: string, opts?: { newTab?: boolean }) => void
}

function LinkRow({ title, snippet, docId, onNavigateToDoc }: LinkRowProps) {
  if (!docId) {
    return (
      <li>
        <div className="w-full rounded-md px-2 py-1.5 text-left">
          <div className="text-sm font-medium text-muted-foreground">
            {title} <span className="text-xs font-normal">(no such note)</span>
          </div>
          {snippet && <div className="truncate text-xs text-muted-foreground/70">{snippet}</div>}
        </div>
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        onClick={(e) => onNavigateToDoc?.(docId, { newTab: e.metaKey || e.ctrlKey })}
        className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent"
      >
        <div className="text-sm font-medium text-foreground">{title}</div>
        {snippet && <div className="truncate text-xs text-muted-foreground">{snippet}</div>}
      </button>
    </li>
  )
}
