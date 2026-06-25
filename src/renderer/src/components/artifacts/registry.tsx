import type { ComponentType } from 'react'
import { FileCode, FileText, type LucideIcon } from 'lucide-react'
import { HtmlViewer } from '../editor/HtmlViewer'
import type { Document, DocumentKind } from '../../../../main/database/types'

/**
 * The renderer-side artifact viewer registry (v2) — the SECOND of the two
 * extension points (the first is `artifact-kinds.ts` in main). Maps a non-note
 * `kind` to the component that renders it, its tree icon, and how it gets bytes:
 *   - `'gt-file'`: an iframe/URL fed by the gt-file:// protocol (HTML).
 *   - `'read'`:    an IPC that returns file contents (a future CSV/JSON viewer).
 *
 * Adding a kind = one entry here + one in `artifact-kinds.ts` + the viewer
 * component. No fork-map site in the pipeline changes.
 */
export interface ArtifactViewerEntry {
  Viewer: ComponentType<{ doc: Document; onQuoteSelection?: (text: string) => void }>
  icon: LucideIcon
  dataSource: 'gt-file' | 'read'
}

/** HTML: served by gt-file:// keyed on the doc id, live-reloading on rewrite. */
function HtmlArtifactViewer({
  doc,
  onQuoteSelection
}: {
  doc: Document
  onQuoteSelection?: (text: string) => void
}) {
  return (
    <HtmlViewer
      gtFileId={doc.id}
      fileName={doc.title}
      watchDocId={doc.id}
      onQuoteSelection={onQuoteSelection}
    />
  )
}

const REGISTRY: Partial<Record<DocumentKind, ArtifactViewerEntry>> = {
  html: { Viewer: HtmlArtifactViewer, icon: FileCode, dataSource: 'gt-file' }
}

/** The viewer for an artifact kind, or null for notes / unregistered kinds. */
export function viewerForKind(kind: DocumentKind | undefined): ArtifactViewerEntry | null {
  if (!kind || kind === 'note') return null
  return REGISTRY[kind] ?? null
}

/** The tree icon for a kind — the registry icon for artifacts, else the note icon. */
export function iconForKind(kind: DocumentKind | undefined): LucideIcon {
  if (kind && kind !== 'note') {
    const entry = REGISTRY[kind]
    if (entry) return entry.icon
  }
  return FileText
}
