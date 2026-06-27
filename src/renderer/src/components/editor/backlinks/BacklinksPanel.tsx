import type { Backlink } from '../../../../../main/vault/documents-service'

interface BacklinksPanelProps {
  backlinks: Backlink[]
  /** Open the source note when a backlink is clicked. */
  onNavigateToDoc?: (docId: string) => void
}

/**
 * The "Linked references" list — notes that link to the current note — rendered
 * inside the note facet bar's inline panel. The facet bar only mounts this when
 * there is at least one backlink, so an empty state isn't needed here.
 */
export function BacklinksPanel({ backlinks, onNavigateToDoc }: BacklinksPanelProps) {
  return (
    <ul className="flex flex-col gap-1">
      {backlinks.map((link) => (
        <li key={link.id}>
          <button
            type="button"
            onClick={() => onNavigateToDoc?.(link.id)}
            className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent"
          >
            <div className="text-sm font-medium text-foreground">{link.title}</div>
            {link.snippet && (
              <div className="truncate text-xs text-muted-foreground">{link.snippet}</div>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
