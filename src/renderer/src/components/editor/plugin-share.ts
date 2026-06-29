import { getSnapshotProvider } from '../artifacts/registry'

/**
 * Publish a shareable plugin artifact by capturing a static snapshot from its
 * LIVE viewer, mirroring {@link publishCanvasShare}.
 *
 * Unlike a canvas (which the renderer re-reads from disk and renders headlessly
 * via `exportToSvg`), only the plugin's own iframe knows how to render its kind,
 * so the snapshot is pulled from the mounted {@link PluginViewer} over its
 * `gt:render-static` → `gt:static` bridge. The returned HTML is self-contained
 * and read-only (no host bridge, no `gt:save`); it is pushed through the SAME
 * prerendered-publish IPC the canvas share uses, where the main process
 * re-authorizes the doc's kind as `shareable` against the trusted manifest cache.
 *
 * The provider only exists while the document is open, which is always true here:
 * publishing is a user action from the header of the active (mounted) tab.
 */
export async function publishPluginShare(
  docId: string
): Promise<{ url: string; slug: string; expiresAt: string }> {
  const provider = getSnapshotProvider(docId)
  if (!provider) throw new Error('Open the document to publish it')
  const entryHtml = await provider()
  return window.api.share.publishCanvas(docId, entryHtml)
}
