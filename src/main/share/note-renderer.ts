import { readFileSync } from 'fs'
import { dirname, extname, join } from 'path'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import { marked } from 'marked'
import { parseHTML } from 'linkedom'
import type { Document } from '../database/types'
import { parseFrontmatter } from '../markdown/frontmatter'
import { resolveGtFileAsset } from '../protocol/gt-file'

/**
 * Render a note document to a single self-contained HTML page for public
 * sharing. The note's markdown body (frontmatter stripped) is rendered with
 * `marked` (GFM, the same engine the PDF export already uses), DOM-sanitized
 * down to a no-script profile, wrapped in a minimal reader template with the
 * app's typographic CSS inlined, and every local image is inlined as a `data:`
 * URI so the published page has zero external dependencies. No scripts,
 * embedding tags, inline event handlers, or `javascript:` URLs are emitted, and
 * the template ships a restrictive CSP. Throws if the final HTML exceeds 5 MB.
 */

const MAX_HTML_BYTES = 5 * 1024 * 1024

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

function imageMimeFor(p: string): string {
  return IMAGE_MIME[extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream'
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Tags that can execute script or load active/embedded content. They are
 * removed entirely (along with their subtree) from published notes.
 */
const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'frame',
  'frameset',
  'noscript',
  'link',
  'base',
  'meta',
  'form',
  'style',
  'template',
  'applet'
])

/** Attributes carrying a URL that must be scheme-checked. */
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'background', 'poster'])

/** True for URLs whose scheme can execute script or smuggle markup. */
function isDangerousUrl(value: string): boolean {
  // Strip control chars/whitespace marked could not, then test the scheme.
  const v = value.replace(/[\u0000-\u0020]+/g, '').toLowerCase()
  return (
    v.startsWith('javascript:') ||
    v.startsWith('vbscript:') ||
    v.startsWith('data:text/html') ||
    v.startsWith('data:application/')
  )
}

/**
 * Run rendered markdown HTML through a real DOM sanitizer with a no-script
 * profile: drop executable/embedding tags, strip every `on*` event-handler
 * attribute, and remove URL attributes pointing at `javascript:`/`vbscript:`/
 * active `data:` schemes. Replaces the prior `<script>`-only regex, which left
 * stored-XSS vectors (onerror=, javascript: hrefs, <iframe>) intact.
 */
function sanitizeHtml(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  for (const el of Array.from(document.querySelectorAll('*'))) {
    const tag = el.tagName?.toLowerCase()
    if (tag && FORBIDDEN_TAGS.has(tag)) {
      el.remove()
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        continue
      }
      if (URL_ATTRS.has(name) && isDangerousUrl(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
  }
  return document.body.innerHTML
}

/**
 * Reject remote image URLs that target the loopback, link-local, or private
 * address space so that publish-time inlining cannot be used to SSRF internal
 * services (e.g. cloud metadata at 169.254.169.254) and embed the response into
 * a public page. Hostnames are DNS-resolved and every returned address checked.
 */
function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase()
  if (isIP(v) === 4) {
    const o = v.split('.').map((n) => parseInt(n, 10))
    if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return true
    const [a, b] = o
    if (a === 0 || a === 127 || a === 10) return true // unspecified, loopback, private
    if (a === 169 && b === 254) return true // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true // private
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true // multicast / reserved
    return false
  }
  // IPv6 (incl. IPv4-mapped) — be conservative.
  if (v === '::' || v === '::1') return true
  if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true // link-local / ULA
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateAddress(mapped[1])
  return false
}

async function isSafeRemoteImageUrl(src: string): Promise<boolean> {
  let u: URL
  try {
    u = new URL(src)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost') return false
  if (isIP(host)) return !isPrivateAddress(host)
  let addrs: Array<{ address: string }>
  try {
    addrs = await lookup(host, { all: true })
  } catch {
    return false
  }
  if (addrs.length === 0) return false
  return addrs.every((a) => !isPrivateAddress(a.address))
}

interface RenderOptions {
  /** Directory where `gt-image://` files live (`<userData>/images`). Omitted in
   *  tests, where no gt-image refs are used. */
  imagesDir?: string
}

/**
 * Resolve a single image src to a `data:` URI, or null if it cannot/should not
 * be inlined (in which case the original src is left untouched).
 */
async function resolveImageDataUri(
  src: string,
  baseDir: string,
  imagesDir: string | undefined
): Promise<string | null> {
  if (src.startsWith('data:')) return null

  // gt-image://<filename> — app-managed image store.
  if (src.startsWith('gt-image://')) {
    if (!imagesDir) return null
    let filename: string
    try {
      const u = new URL(src)
      filename = decodeURIComponent(u.hostname || u.pathname.replace(/^\/+/, ''))
    } catch {
      return null
    }
    try {
      const bytes = readFileSync(join(imagesDir, filename))
      if (bytes.byteLength > MAX_HTML_BYTES) return null
      return `data:${imageMimeFor(filename)};base64,${bytes.toString('base64')}`
    } catch {
      return null
    }
  }

  // Remote image — fetch and inline, but only from public hosts so publish
  // cannot be steered into an SSRF against link-local / private addresses.
  if (/^https?:\/\//i.test(src)) {
    if (!(await isSafeRemoteImageUrl(src))) return null
    try {
      const res = await fetch(src, { redirect: 'error' })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_HTML_BYTES) return null
      const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || imageMimeFor(src)
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }

  // Protocol-relative / mail / anchors are not inlinable images.
  if (src.startsWith('//') || src.startsWith('#') || src.startsWith('mailto:')) return null

  // Relative / vault ref — resolve against the note's own dir with a realpath
  // clamp (same traversal guard the gt-file protocol uses).
  const abs = resolveGtFileAsset({ baseDir, requestPathname: src })
  if (!abs) return null
  try {
    const bytes = readFileSync(abs)
    if (bytes.byteLength > MAX_HTML_BYTES) return null
    return `data:${imageMimeFor(abs)};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/** Inline every <img src> in the rendered HTML as a data: URI where possible. */
async function inlineImages(
  html: string,
  baseDir: string,
  imagesDir: string | undefined
): Promise<string> {
  const srcRe = /<img\b[^>]*?\ssrc=(["'])([^"']+)\1[^>]*>/gi
  const srcs = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = srcRe.exec(html)) !== null) srcs.add(m[2])

  const map = new Map<string, string>()
  for (const src of srcs) {
    const dataUri = await resolveImageDataUri(src, baseDir, imagesDir)
    if (dataUri) map.set(src, dataUri)
  }
  if (map.size === 0) return html

  return html.replace(srcRe, (full, quote: string, src: string) => {
    const replacement = map.get(src)
    if (!replacement) return full
    return full.replace(`src=${quote}${src}${quote}`, `src=${quote}${replacement}${quote}`)
  })
}

/**
 * Reader stylesheet — a system-font typographic baseline mirrored from the
 * DOM-free PDF export template (`register-system-handlers.ts`), so a published
 * note reads the same as an exported one without depending on bundled fonts.
 */
const READER_CSS = `
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    color: #1a1a1a;
    background: #fff;
    margin: 0;
    padding: 2.5rem 1.25rem;
  }
  main { max-width: 720px; margin: 0 auto; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 0.5em; font-weight: 600; }
  h1 { font-size: 2em; }
  h2 { font-size: 1.5em; }
  h3 { font-size: 1.25em; }
  p { margin: 0.6em 0; }
  ul, ol { padding-left: 1.5em; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.9em;
    background: #f4f4f4;
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  pre { background: #f4f4f4; padding: 0.8em; border-radius: 5px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote {
    margin: 0.8em 0;
    padding-left: 1em;
    border-left: 3px solid #ddd;
    color: #555;
  }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 0.4em 0.6em; text-align: left; }
  img { max-width: 100%; height: auto; }
  a { color: #0b6bcb; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1.6em 0; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e6e6; background: #1a1a1a; }
    code, pre { background: #2a2a2a; }
    blockquote { border-left-color: #444; color: #aaa; }
    th, td, hr { border-color: #333; }
    a { color: #6db3f7; }
  }
`

export async function renderNoteToHtml(doc: Document, opts: RenderOptions = {}): Promise<string> {
  if (!doc.file_path) throw new Error('Note has no backing file to share')

  const raw = readFileSync(doc.file_path, 'utf-8')
  const { body } = parseFrontmatter(raw)
  const title = doc.title || 'Untitled'

  const rendered = sanitizeHtml(await marked.parse(body))
  const inlined = await inlineImages(rendered, dirname(doc.file_path), opts.imagesDir)

  const safeTitle = escapeHtml(title)
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta property="og:title" content="${safeTitle}" />
<title>${safeTitle}</title>
<style>${READER_CSS}</style>
</head>
<body>
<main>
${inlined}
</main>
</body>
</html>`

  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes > MAX_HTML_BYTES) {
    throw new Error(
      `Rendered note is ${(bytes / 1024 / 1024).toFixed(1)} MB, exceeding the 5 MB share limit`
    )
  }
  return html
}
