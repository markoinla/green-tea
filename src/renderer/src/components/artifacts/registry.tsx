import type { ComponentType } from 'react'
import {
  FileCode,
  FileImage,
  FileText,
  Puzzle,
  Shapes,
  Table2,
  type LucideIcon
} from 'lucide-react'
import { resolveLucideIcon } from './lucide-icon'
import { HtmlViewer } from '../editor/HtmlViewer'
import { TableViewer } from '../editor/TableViewer'
import { ImageViewer } from '../editor/ImageViewer'
import { PdfViewer } from '../editor/PdfViewer'
import { CanvasViewer } from '../editor/CanvasViewer'
import { PluginViewer } from '../editor/PluginViewer'
import type { BuiltinDocumentKind, Document, DocumentKind } from '../../../../main/database/types'
import type { ViewerContribution } from '../../../../main/plugins/types'

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

const REGISTRY: Partial<Record<BuiltinDocumentKind, ArtifactViewerEntry>> = {
  html: { Viewer: HtmlArtifactViewer, icon: FileCode, dataSource: 'gt-file' },
  csv: { Viewer: TableArtifactViewer, icon: Table2, dataSource: 'read' },
  image: { Viewer: ImageArtifactViewer, icon: FileImage, dataSource: 'gt-file' },
  pdf: { Viewer: PdfArtifactViewer, icon: FileText, dataSource: 'gt-file' },
  canvas: { Viewer: CanvasArtifactViewer, icon: Shapes, dataSource: 'read' }
}

/**
 * The plugin-viewer store: the flat `ViewerContribution[]` of every enabled
 * plugin, keyed by namespaced kind (`plugin:<id>:<kind>`). Populated by main via
 * the IPC bridge (`window.api.plugins.viewers()` → `setPluginViewers`) and kept in
 * sync on `plugins:changed`. Built-in REGISTRY never holds plugin kinds; they're
 * routed through here instead.
 */
let PLUGIN_VIEWERS: Record<string, ViewerContribution> = {}
const pluginViewerSubscribers = new Set<() => void>()
// Bumped on every store replacement so `useSyncExternalStore` consumers (e.g.
// AppLayout's `canShare`) re-read after the contributions arrive asynchronously.
let pluginViewersVersion = 0

/** Replace the plugin-viewer store and notify subscribers (re-renders trees/tabs). */
export function setPluginViewers(contributions: ViewerContribution[]): void {
  const next: Record<string, ViewerContribution> = {}
  for (const c of contributions) next[c.kind] = c
  PLUGIN_VIEWERS = next
  pluginViewersVersion++
  for (const cb of pluginViewerSubscribers) cb()
}

/** Subscribe to plugin-viewer store changes; returns an unsubscribe fn. */
export function subscribePluginViewers(cb: () => void): () => void {
  pluginViewerSubscribers.add(cb)
  return () => {
    pluginViewerSubscribers.delete(cb)
  }
}

/** Monotonic store version — the `getSnapshot` half of `subscribePluginViewers`. */
export function getPluginViewersVersion(): number {
  return pluginViewersVersion
}

/**
 * True when `kind` is a plugin artifact whose contribution opts into public
 * sharing (`shareable === true` in its manifest). The renderer gate; the main
 * process re-authorizes server-side against the trusted manifest cache.
 */
export function isShareablePluginKind(kind: DocumentKind | undefined): boolean {
  return !!kind && kind.startsWith('plugin:') && PLUGIN_VIEWERS[kind]?.shareable === true
}

/**
 * Snapshot-provider registry, keyed by doc id. A mounted {@link PluginViewer}
 * registers a function that asks its live iframe for a self-contained, read-only
 * HTML snapshot (the `gt:render-static` → `gt:static` round-trip); the share UI
 * looks it up by the active doc id at publish time. Unlike canvas (which renders
 * headlessly from raw bytes), a plugin snapshot needs the live frame, so the
 * provider is only available while the document is open.
 */
const snapshotProviders = new Map<string, () => Promise<string>>()

/** Register a doc's snapshot provider; returns an unregister fn for cleanup. */
export function registerSnapshotProvider(docId: string, fn: () => Promise<string>): () => void {
  snapshotProviders.set(docId, fn)
  return () => {
    if (snapshotProviders.get(docId) === fn) snapshotProviders.delete(docId)
  }
}

/** The snapshot provider for an open plugin doc, or null when it isn't mounted. */
export function getSnapshotProvider(docId: string): (() => Promise<string>) | null {
  return snapshotProviders.get(docId) ?? null
}

/** The viewer entry for a plugin kind, or null when no enabled plugin provides it. */
function pluginViewerForKind(kind: string): ArtifactViewerEntry | null {
  const contribution = PLUGIN_VIEWERS[kind]
  if (!contribution) return null
  return {
    Viewer: (props) => <PluginViewer contribution={contribution} {...props} />,
    icon: resolveLucideIcon(contribution.icon),
    dataSource: 'read'
  }
}

/** The viewer for an artifact kind, or null for notes / unregistered kinds. */
export function viewerForKind(kind: DocumentKind | undefined): ArtifactViewerEntry | null {
  if (!kind || kind === 'note') return null
  if (kind.startsWith('plugin:')) return pluginViewerForKind(kind)
  return REGISTRY[kind as BuiltinDocumentKind] ?? null
}

/** The tree icon for a kind — the registry icon for artifacts, else the note icon. */
export function iconForKind(kind: DocumentKind | undefined): LucideIcon {
  if (kind && kind !== 'note') {
    if (kind.startsWith('plugin:')) {
      const contribution = PLUGIN_VIEWERS[kind]
      if (contribution) return resolveLucideIcon(contribution.icon)
      return Puzzle
    }
    const entry = REGISTRY[kind as BuiltinDocumentKind]
    if (entry) return entry.icon
  }
  return FileText
}
