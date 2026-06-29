import Papa from 'papaparse'

/**
 * Render a CSV "Table" artifact to a self-contained static HTML page and publish it.
 *
 * A `.csv` file is plain text — a browser shows raw commas, not a grid. So we parse
 * it HERE (PapaParse, the same lib the live `TableViewer` uses) and emit a minimal
 * styled `<table>` wrapped in a complete HTML page, then hand that to the main
 * process, which pushes it through the existing prerendered `artifact` share path
 * (`share.publishCanvas`, the kind-agnostic prerendered pipe). The page inlines all
 * its own CSS and carries no scripts or sibling assets, so it renders offline in any
 * browser.
 *
 * The first row is treated as a header (matching how the grid presents a CSV); every
 * cell is rendered as text, HTML-escaped. An empty file yields an empty table.
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

/** A single `<tr>` of `<th>`/`<td>` cells from one parsed CSV row. */
function renderRow(cells: string[], tag: 'th' | 'td'): string {
  const tds = cells.map((c) => `<${tag}>${escapeHtml(c ?? '')}</${tag}>`).join('')
  return `<tr>${tds}</tr>`
}

/**
 * Minimal self-contained page: a styled table on a neutral backdrop. The first
 * parsed row becomes a sticky header; remaining rows are the body. Columns are
 * padded to the widest row so a ragged CSV still renders a rectangular grid.
 */
function wrapTableAsHtml(rows: string[][], title: string): string {
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0)
  const pad = (r: string[]): string[] =>
    r.length === width ? r : [...r, ...Array(width - r.length).fill('')]

  const [header, ...body] = rows
  const thead = header ? `<thead>${renderRow(pad(header), 'th')}</thead>` : ''
  const tbody = body.length
    ? `<tbody>${body.map((r) => renderRow(pad(r), 'td')).join('')}</tbody>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; background: #f8f9fa; }
  body { padding: 24px; box-sizing: border-box; font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2328; }
  .wrap { overflow-x: auto; border: 1px solid #d0d7de; border-radius: 8px; background: #fff; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 6px 12px; text-align: left; border-bottom: 1px solid #eaeef2; border-right: 1px solid #eaeef2; white-space: pre-wrap; vertical-align: top; }
  th:last-child, td:last-child { border-right: none; }
  thead th { position: sticky; top: 0; background: #f6f8fa; font-weight: 600; border-bottom: 1px solid #d0d7de; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) { background: #fbfcfd; }
</style>
</head>
<body>
<div class="wrap">
<table>${thead}${tbody}</table>
</div>
</body>
</html>`
}

/**
 * Export the table `docId` to a static page and publish it (or re-publish to the
 * existing slug). Returns the live URL + derived expiry, mirroring
 * `window.api.share.publish` so the share UI can treat every path identically.
 */
export async function publishCsvShare(
  docId: string,
  title: string
): Promise<{ url: string; slug: string; expiresAt: string }> {
  const text = await window.api.readArtifactText(docId)
  // skipEmptyLines so a trailing newline doesn't render a blank final row.
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true })
  const rows = (parsed.data ?? []).filter(Array.isArray)

  const entryHtml = wrapTableAsHtml(rows, title || 'Table')
  return window.api.share.publishCanvas(docId, entryHtml)
}
