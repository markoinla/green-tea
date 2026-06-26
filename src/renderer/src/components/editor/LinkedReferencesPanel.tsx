import { useCallback, useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'
import type { Backlink } from '../../../../main/vault/documents-service'

interface LinkedReferencesPanelProps {
  documentId: string
  /** Open the source note when a backlink is clicked. */
  onNavigateToDoc?: (docId: string) => void
}

/**
 * Obsidian-style "Linked references" — the notes that link to the current note
 * via a [[wiki-link]], shown at the foot of the document. Renders nothing until
 * at least one backlink exists, so notes with none stay uncluttered. Refetches
 * when any document changes (a link may have been added elsewhere).
 */
export function LinkedReferencesPanel({
  documentId,
  onNavigateToDoc
}: LinkedReferencesPanelProps): React.JSX.Element | null {
  const [backlinks, setBacklinks] = useState<Backlink[]>([])

  const load = useCallback(async () => {
    try {
      const result = (await window.api.documents.backlinks(documentId)) as Backlink[]
      setBacklinks(result)
    } catch {
      // best-effort; an empty panel is the right fallback on failure
      setBacklinks([])
    }
  }, [documentId])

  useEffect(() => {
    load()
    const off = window.api.onDocumentsChanged(load)
    return off
  }, [load])

  if (backlinks.length === 0) return null

  return (
    <div className="mx-auto mt-8 max-w-2xl border-t border-border px-4 py-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" />
        <span>Linked references ({backlinks.length})</span>
      </div>
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
    </div>
  )
}
