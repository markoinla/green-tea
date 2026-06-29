import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'

/**
 * Render a canvas artifact to a self-contained static HTML page and publish it.
 *
 * The `.excalidraw` file is JSON — it renders nothing in a browser without the
 * Excalidraw runtime. So we export the scene to a static SVG HERE (`exportToSvg`
 * needs a DOM, which only the renderer has), wrap it in a minimal HTML page, and
 * hand that to the main process, which pushes it through the existing `artifact`
 * share path. `exportToSvg` inlines fonts AND base64 images by default, so the
 * page is fully self-contained: no sibling assets, renders offline in any browser
 * with no runtime.
 *
 * Excalidraw is lazy-imported so it stays out of the header/main bundle — it only
 * loads when the user actually publishes a canvas (and reuses the same chunk the
 * canvas viewer already loads when one is open).
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c])
}

/**
 * Minimal self-contained page: the inlined SVG centered on a neutral backdrop.
 *
 * The SVG carries explicit width/height plus a viewBox. We override both with
 * `width/height: auto` and cap with `max-width/max-height: 100%` so the browser
 * scales by the intrinsic aspect ratio to fit WITHIN the padded viewport in both
 * dimensions — a tall or wide diagram shrinks to fit rather than overflowing the
 * flex-centered box and clipping (constraining width alone clipped tall scenes).
 */
function wrapSvgAsHtml(svgMarkup: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #f8f9fa; }
  body { display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; }
  svg { max-width: 100%; max-height: 100%; width: auto; height: auto; display: block; }
</style>
</head>
<body>
${svgMarkup}
</body>
</html>`
}

/**
 * Export the canvas `docId` to a static page and publish it (or re-publish to the
 * existing slug). Returns the live URL + derived expiry, mirroring
 * `window.api.share.publish` so the share UI can treat both paths identically.
 */
export async function publishCanvasShare(
  docId: string,
  title: string
): Promise<{ url: string; slug: string; expiresAt: string }> {
  const text = await window.api.readArtifactText(docId)
  const scene = JSON.parse(text) as Partial<ExcalidrawInitialDataState>

  // Lazy-load so Excalidraw stays out of the main bundle (this runs only on publish).
  const { exportToSvg } = await import('@excalidraw/excalidraw')

  const svg = await exportToSvg({
    elements: scene.elements ?? [],
    // Force a light export regardless of the app chrome theme — scene colors are
    // data baked into the file; a dark-mode export would bake a black page.
    appState: {
      ...(scene.appState ?? {}),
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: scene.appState?.viewBackgroundColor ?? '#ffffff'
    },
    files: scene.files ?? null
  })

  const entryHtml = wrapSvgAsHtml(svg.outerHTML, title || 'Canvas')
  return window.api.share.publishCanvas(docId, entryHtml)
}
