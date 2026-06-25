import type Database from 'better-sqlite3'
import { readFile, realpath } from 'fs/promises'
import { realpathSync } from 'fs'
import { dirname, extname, join, normalize, relative, isAbsolute, sep } from 'path'
import { getWorkspaceFileById } from '../database/repositories/workspace-files'

/**
 * The gt-file:// protocol serves an HTML artifact (a `workspace_files` row) and
 * its sibling assets to a sandboxed iframe. The workspace-file id is the URL
 * authority (host):
 *
 *   gt-file://<workspaceFileId>/                       -> the artifact's own file
 *   gt-file://<workspaceFileId>/<relativeAssetPath>    -> a sibling asset
 *
 * It is modeled on the older gt-image handler but corrected: gt-file has real
 * path-traversal protection (realpath clamp to the file's own directory) and is
 * NOT registered bypassCSP — a real Content-Security-Policy response header is
 * emitted on every response so the CSP actually governs the document.
 */

export const GT_FILE_SCHEME = 'gt-file'

/**
 * Privilege descriptor to be added to the existing
 * `protocol.registerSchemesAsPrivileged([...])` array in index.ts. Note the
 * deliberate absence of `bypassCSP` — we emit our own CSP header instead.
 */
export const GT_FILE_PRIVILEGE = {
  scheme: GT_FILE_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true
  }
} as const

/**
 * v1 CSP posture: remote allowed (CDN libraries are common in agent-authored
 * HTML). gt-file:// served sub-assets count as 'self'. Tightening later means
 * editing only this string.
 */
export function buildGtFileCsp(): string {
  // NOTE: deliberately NO `frame-ancestors`. The artifact is rendered only
  // inside HtmlViewer's iframe, whose parent is the app renderer (origin
  // `file://` in prod, `http://localhost` in dev) — a DIFFERENT origin from the
  // served document (`gt-file://<id>`). `frame-ancestors 'self'` matches only the
  // document's own origin, so it would block the legitimate viewer just like
  // `'none'` and blank the frame. Omitting the directive is safe here because
  // `gt-file://` is an internal privileged scheme that is not navigable from the
  // open web (no external page can embed it), and the iframe is already sandboxed
  // to an opaque origin with no IPC — so there is no clickjacking threat to gate.
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' https:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' https: data:",
    "font-src 'self' https: data:",
    "connect-src 'self' https:"
  ].join('; ')
}

const MIME_MAP: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  ico: 'image/x-icon',
  map: 'application/json'
}

function contentTypeFor(absPath: string): string {
  const ext = extname(absPath).slice(1).toLowerCase()
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

/**
 * Pure traversal-guarded resolver. Given the artifact's directory (`baseDir`)
 * and the request URL pathname, return the absolute path of the asset to serve,
 * or `null` if the request is rejected.
 *
 * Algorithm: decode -> normalize -> join under baseDir -> realpath both -> assert
 * the target's realpath stays inside the realpath of baseDir (the relative path
 * must not be `..`-escaping and must not be absolute). Absolute request paths are
 * rejected outright. Any realpath failure (missing file, escaping symlink) yields
 * null.
 */
export function resolveGtFileAsset({
  baseDir,
  requestPathname
}: {
  baseDir: string
  requestPathname: string
}): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPathname)
  } catch {
    return null
  }

  // Strip a single leading slash that the URL parser supplies; an empty result
  // means "the entry file itself", which the handler resolves separately. Here
  // we treat empty as a rejection because the caller handles entry separately.
  const stripped = decoded.replace(/^\/+/, '')
  if (stripped.length === 0) return null

  // Reject absolute request paths outright (e.g. "/etc/passwd" after stripping
  // would be relative, but a Windows drive or backslash-absolute must be caught,
  // and any normalized absolute form is rejected below as well).
  if (isAbsolute(stripped)) return null

  const normalized = normalize(stripped)

  // Fast structural reject: a normalized path that still begins with `..` (or is
  // absolute after normalization) escapes the base.
  if (normalized === '..' || normalized.startsWith('..' + sep) || isAbsolute(normalized)) {
    return null
  }

  // Resolve the clamp root. If baseDir cannot be realpath'd, reject.
  let realBase: string
  try {
    realBase = realpathSync(baseDir)
  } catch {
    return null
  }

  const target = join(realBase, normalized)

  let realTarget: string
  try {
    realTarget = realpathSync(target)
  } catch {
    return null
  }

  const rel = relative(realBase, realTarget)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return null
  }

  return realTarget
}

/**
 * Build the gt-file:// protocol handler bound to a database. The handler reads
 * the workspace-file id from the URL host, looks up its absolute `file_path`,
 * and serves either that file (root pathname) or a traversal-guarded sibling
 * asset under its directory. Every response carries the CSP header. Any
 * miss/rejection returns a 404.
 */
export function createGtFileHandler(
  db: Database.Database
): (request: GlobalRequest) => Promise<GlobalResponse> {
  return async (request: GlobalRequest): Promise<GlobalResponse> => {
    const notFound = (): GlobalResponse =>
      new Response('Not found', {
        status: 404,
        headers: { 'Content-Security-Policy': buildGtFileCsp() }
      })

    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return notFound()
    }

    const workspaceFileId = url.hostname
    if (!workspaceFileId) return notFound()

    const row = getWorkspaceFileById(db, workspaceFileId)
    if (!row || !row.file_path) return notFound()

    const baseDir = dirname(row.file_path)

    // Empty / "/" pathname => serve the artifact's own file.
    const pathname = url.pathname.replace(/^\/+/, '')

    let absPath: string
    if (pathname.length === 0) {
      // Serve the entry file itself, but still validate it resolves and stays
      // inside its own directory (defends against a symlinked entry escaping).
      let realBase: string
      let realEntry: string
      try {
        realBase = await realpath(baseDir)
        realEntry = await realpath(row.file_path)
      } catch {
        return notFound()
      }
      const rel = relative(realBase, realEntry)
      if (rel.startsWith('..') || isAbsolute(rel)) return notFound()
      absPath = realEntry
    } else {
      const resolved = resolveGtFileAsset({ baseDir, requestPathname: url.pathname })
      if (!resolved) return notFound()
      absPath = resolved
    }

    let data: Buffer
    try {
      data = await readFile(absPath)
    } catch {
      return notFound()
    }

    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': contentTypeFor(absPath),
        'Content-Security-Policy': buildGtFileCsp()
      }
    })
  }
}
