import { readFileSync, realpathSync } from 'fs'
import { dirname, relative } from 'path'
import { resolveGtFileAsset } from '../protocol/gt-file'
import type { PublishArtifactAsset } from '../../shared/share-contract'

/**
 * Collect the referenced, in-directory assets of an HTML artifact for
 * publishing. The entry HTML on disk is read verbatim (NOT via the gt-file
 * protocol, which injects a picker bootstrap), its `src`/`href`/`url(...)`
 * references are parsed, and each RELATIVE reference is resolved against the
 * artifact's own directory with the same realpath traversal clamp the gt-file
 * protocol uses. Only files that resolve inside that directory are uploaded —
 * sibling notes/artifacts that the HTML does not reference are never leaked.
 *
 * Absolute (`https:`), protocol-relative (`//`), `gt-file://`, `data:`,
 * fragment (`#`), and `mailto:` references — plus anything the static walk
 * can't resolve (e.g. a `../` escape or a missing file) — are skipped and
 * reported in `warnings` so the caller can warn the user that those refs will
 * not resolve on the public page.
 *
 * Throws if the combined byte size (entry HTML + assets) exceeds 5 MB.
 */

const MAX_TOTAL_BYTES = 5 * 1024 * 1024

export interface WalkResult {
  entryHtml: string
  assets: PublishArtifactAsset[]
  warnings: string[]
}

/** Extract every src=, href=, and url(...) reference from HTML text. */
function extractRefs(html: string): string[] {
  const refs: string[] = []
  const attrRe = /(?:src|href)\s*=\s*(["'])([^"']*)\1/gi
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(html)) !== null) refs.push(m[2])
  while ((m = urlRe.exec(html)) !== null) refs.push(m[2])
  return refs
}

function isSkippable(ref: string): boolean {
  if (ref.length === 0) return true
  if (ref.startsWith('#')) return true
  if (ref.startsWith('data:')) return true
  if (ref.startsWith('mailto:')) return true
  if (ref.startsWith('//')) return true // protocol-relative
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return true // any scheme: https:, gt-file:, etc.
  return false
}

export function walkArtifactAssets(entryHtmlPath: string): WalkResult {
  const entryHtml = readFileSync(entryHtmlPath, 'utf-8')
  const baseDir = dirname(entryHtmlPath)
  const realBase = realpathSync(baseDir)

  const warnings: string[] = []
  const assets: PublishArtifactAsset[] = []
  const seenPaths = new Set<string>()

  let totalBytes = Buffer.byteLength(entryHtml, 'utf8')

  for (const ref of extractRefs(entryHtml)) {
    if (isSkippable(ref)) {
      // Only warn for refs that point at remote/unfetchable resources the page
      // will try to load (skip pure fragments/data/mailto which are fine).
      if (
        !ref.startsWith('#') &&
        !ref.startsWith('data:') &&
        !ref.startsWith('mailto:') &&
        ref.length > 0
      ) {
        warnings.push(`Skipped non-local reference (will not be inlined): ${ref}`)
      }
      continue
    }

    // Drop any query/fragment before resolving on disk.
    const cleanRef = ref.split(/[?#]/)[0]
    if (cleanRef.length === 0) continue

    const abs = resolveGtFileAsset({ baseDir, requestPathname: cleanRef })
    if (!abs) {
      warnings.push(`Unresolvable or out-of-directory reference (skipped): ${ref}`)
      continue
    }

    const relPath = relative(realBase, abs).split(/[\\/]/).join('/')
    if (seenPaths.has(relPath)) continue
    seenPaths.add(relPath)

    let bytes: Buffer
    try {
      bytes = readFileSync(abs)
    } catch {
      warnings.push(`Failed to read referenced file (skipped): ${ref}`)
      continue
    }

    totalBytes += bytes.byteLength
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        `Artifact assets exceed the 5 MB share limit (reached ${(
          totalBytes /
          1024 /
          1024
        ).toFixed(1)} MB at ${relPath})`
      )
    }

    assets.push({ path: relPath, contentBase64: bytes.toString('base64') })
  }

  return { entryHtml, assets, warnings }
}
