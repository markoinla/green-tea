import type Database from 'better-sqlite3'
import { readFile, realpath } from 'fs/promises'
import { extname, join, relative, isAbsolute } from 'path'
import { getPluginsDir } from '../plugins/manager'
import { resolveGtFileAsset, buildGtFileCsp } from './gt-file'

/**
 * The gt-plugin:// protocol serves a plugin's static viewer assets to a
 * sandboxed iframe. The URL authority (host) is the plugin id; the pathname is a
 * path relative to that plugin's on-disk directory:
 *
 *   gt-plugin://<pluginId>/             -> rejected (no implicit entry file)
 *   gt-plugin://<pluginId>/<asset>      -> a file under getPluginsDir(db)/<pluginId>/
 *
 * Unlike gt-file://, there is NO picker-bootstrap injection — plugin assets are
 * served byte-for-byte. It reuses gt-file's `resolveGtFileAsset` traversal guard
 * (realpath clamp to the plugin dir) and `buildGtFileCsp`, and like gt-file it is
 * NOT registered bypassCSP — a real CSP header is emitted on HTML responses.
 */

export const GT_PLUGIN_SCHEME = 'gt-plugin'

/**
 * Privilege descriptor to be added to the existing
 * `protocol.registerSchemesAsPrivileged([...])` array in index.ts, mirroring
 * GT_FILE_PRIVILEGE. Note the deliberate absence of `bypassCSP` — we emit our own
 * CSP header instead.
 */
export const GT_PLUGIN_PRIVILEGE = {
  scheme: GT_PLUGIN_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true
  }
} as const

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
  pdf: 'application/pdf',
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
 * Build the gt-plugin:// protocol handler bound to a database. The handler reads
 * the plugin id from the URL host, resolves the request path against that
 * plugin's directory (traversal-guarded), and serves the asset. HTML responses
 * carry the CSP header. Any miss/rejection returns a 404.
 */
export function createGtPluginHandler(
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

    const pluginId = url.hostname
    if (!pluginId) return notFound()

    // The plugin's own directory is the clamp root for every asset request.
    const baseDir = join(getPluginsDir(db), pluginId)

    // Empty / "/" pathname has no implicit entry file for a plugin — reject.
    const stripped = url.pathname.replace(/^\/+/, '')
    if (stripped.length === 0) return notFound()

    const resolved = resolveGtFileAsset({ baseDir, requestPathname: url.pathname })
    if (!resolved) return notFound()

    // Defense-in-depth: re-assert the resolved asset stays inside the plugin dir.
    try {
      const realBase = await realpath(baseDir)
      const realTarget = await realpath(resolved)
      const rel = relative(realBase, realTarget)
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return notFound()
    } catch {
      return notFound()
    }

    let data: Buffer
    try {
      data = await readFile(resolved)
    } catch {
      return notFound()
    }

    const contentType = contentTypeFor(resolved)
    const body = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
    const headers: Record<string, string> = { 'Content-Type': contentType }
    if (contentType === 'text/html') headers['Content-Security-Policy'] = buildGtFileCsp()
    return new Response(body, { headers })
  }
}
