import { extname } from 'path'
import type { BuiltinDocumentKind, DocumentKind } from '../database/types'

export type { DocumentKind }

/**
 * The artifact-kind registry (v2). A single source of truth mapping a file
 * extension to its `kind`. The vault walk, `rowToDocument`, the watcher, and the
 * gt-file protocol all read `kindForExt` so the pipeline forks on a derived kind
 * rather than scattering `endsWith('.md')` / `=== 'html'` checks.
 *
 * The pipeline fork is BINARY — `note` (markdown, the genuine editor path) vs
 * everything else, which is an "artifact" (served, never markdown-parsed). The
 * specific non-note kind (`html`, later `csv`, `pdf`, …) selects the renderer's
 * viewer. Adding a kind starts here: add one entry, then a viewer-registry entry
 * in the renderer. An unmapped extension is intentionally NOT indexed.
 */

/** Extension (lowercased, no dot) → builtin kind. The only place builtins are listed. */
const EXT_TO_KIND: Record<string, BuiltinDocumentKind> = {
  md: 'note',
  html: 'html',
  htm: 'html',
  csv: 'csv',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  pdf: 'pdf',
  excalidraw: 'canvas'
}

/**
 * Plugin-contributed extension → namespaced kind (`plugin:<id>:<kind>`). Populated
 * by the plugin registry via `setPluginExtMap` whenever enabled plugins change.
 * Consulted only after builtins, so a builtin extension can never be overridden.
 */
let pluginExtMap: Record<string, string> = {}

/** Replace the plugin extension map (ext, no dot, lowercase → namespaced kind). */
export function setPluginExtMap(map: Record<string, string>): void {
  pluginExtMap = map
}

/** The kind for a file path, or `null` when its extension isn't indexed at all. */
export function kindForExt(filePath: string): DocumentKind | null {
  const ext = extname(filePath).slice(1).toLowerCase()
  return EXT_TO_KIND[ext] ?? pluginExtMap[ext] ?? null
}

/** True for the genuine markdown-note path; false for every artifact kind. */
export function isNoteKind(kind: DocumentKind): boolean {
  return kind === 'note'
}

/**
 * The kind to store on a `documents` row for a path, defaulting an unmapped or
 * extension-less path to `note` (notes always carry `.md`, so this only guards
 * against an unexpected row — never silently mints an artifact).
 */
export function kindForRow(filePath: string | null | undefined): DocumentKind {
  if (!filePath) return 'note'
  return kindForExt(filePath) ?? 'note'
}
