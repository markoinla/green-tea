import type { ComponentType } from 'react'
import { FileCode, FileImage, FileText, Shapes, Table2, type LucideIcon } from 'lucide-react'
import { HtmlViewer } from '../editor/HtmlViewer'
import { TableViewer } from '../editor/TableViewer'
import { ImageViewer } from '../editor/ImageViewer'
import { PdfViewer } from '../editor/PdfViewer'
import { CanvasViewer } from '../editor/CanvasViewer'
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

/** Table (CSV): EDITABLE grid; bytes over readArtifact/writeArtifact IPC. */
function TableArtifactViewer({
  doc
}: {
  doc: Document
  onQuoteSelection?: (text: string) => void
}) {
  return <TableViewer gtFileId={doc.id} fileName={doc.title} watchDocId={doc.id} />
}

/** Image: streamed by gt-file:// via <img>, live-reloading on rewrite. */
function ImageArtifactViewer({
  doc
}: {
  doc: Document
  onQuoteSelection?: (text: string) => void
}) {
  return <ImageViewer gtFileId={doc.id} fileName={doc.title} watchDocId={doc.id} />
}

/** PDF: served by gt-file:// in a sandboxed iframe (native Chromium viewer). */
function PdfArtifactViewer({ doc }: { doc: Document; onQuoteSelection?: (text: string) => void }) {
  return <PdfViewer gtFileId={doc.id} fileName={doc.title} watchDocId={doc.id} />
}

/** Canvas: EDITABLE Excalidraw scene; bytes over readArtifact/writeArtifact IPC. */
function CanvasArtifactViewer({
  doc
}: {
  doc: Document
  onQuoteSelection?: (text: string) => void
}) {
  return <CanvasViewer gtFileId={doc.id} fileName={doc.title} watchDocId={doc.id} />
}

const REGISTRY: Partial<Record<DocumentKind, ArtifactViewerEntry>> = {
  html: { Viewer: HtmlArtifactViewer, icon: FileCode, dataSource: 'gt-file' },
  csv: { Viewer: TableArtifactViewer, icon: Table2, dataSource: 'read' },
  image: { Viewer: ImageArtifactViewer, icon: FileImage, dataSource: 'gt-file' },
  pdf: { Viewer: PdfArtifactViewer, icon: FileText, dataSource: 'gt-file' },
  canvas: { Viewer: CanvasArtifactViewer, icon: Shapes, dataSource: 'read' }
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
