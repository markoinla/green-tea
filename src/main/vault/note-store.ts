import { randomUUID } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, dirname, join, relative, sep } from 'path'
import { parseFrontmatter } from '../markdown/frontmatter'
import { parseNoteFile, serializeNoteFile, type NoteFile } from '../markdown/note-file'
import type { TTDoc } from '../markdown/tiptap-markdown'
import { markSelfWrite } from './self-write'
import { kindForExt, type DocumentKind } from './artifact-kinds'

/**
 * The vault note store: all filesystem reads/writes for markdown notes. Files
 * are the source of truth; this module is the only thing that touches them, so
 * the rules (identity in frontmatter, filename-as-title, atomic writes, the
 * ignore-list) live in one place.
 */

// Directories never treated as containing notes (Q13). `attachments` holds
// binaries referenced by notes but is not itself a note location.
const IGNORED_DIRS = new Set(['.git', '.obsidian', 'node_modules', 'attachments', '.trash'])

// Files larger than this are skipped by the indexer (defensive; a note is text).
export const MAX_NOTE_BYTES = 2 * 1024 * 1024

// Artifacts (html, …) are served, not parsed, and routinely inline libraries or
// data far past a note's text budget — so they get a much larger cap. The body is
// never read at index time, so this only bounds what the tree will surface.
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024

// Image and PDF artifacts are served to the renderer over gt-file:// (no text
// read at index time), so a single high-resolution image or a large PDF can dwarf
// the 25 MB text-artifact budget and gets a larger ceiling so it isn't silently
// dropped from the tree. The ceiling is deliberately modest: the gt-file handler
// reads the whole file into a Buffer in the (single-threaded) main process per
// request — it does NOT stream — so this is the largest size we're willing to
// transiently buffer. Raising it requires converting the handler to a real stream
// (+ HTTP Range) first; see docs/plans/2026-06-26-pdf-image-artifact-viewers.md.
export const MAX_BINARY_ARTIFACT_BYTES = 75 * 1024 * 1024

/**
 * The indexing size ceiling for a kind. Notes are text (small budget); image/pdf
 * are served over gt-file:// and get the larger binary ceiling; every other artifact keeps
 * the text-artifact budget. Used at the walk + reindex gating sites so the cap is
 * uniform. NOTE: `documents:readArtifact` (text read for csv/html) intentionally
 * keeps the 25 MB `MAX_ARTIFACT_BYTES` directly — image/pdf never route through it
 * (they use the gt-file streaming path), so they are not affected by that cap.
 */
export function maxBytesForKind(kind: DocumentKind): number {
  if (kind === 'note') return MAX_NOTE_BYTES
  if (kind === 'image' || kind === 'pdf') return MAX_BINARY_ARTIFACT_BYTES
  return MAX_ARTIFACT_BYTES
}

export interface VaultNote {
  /** Stable identity from frontmatter `id`. */
  id: string
  /** Display title: frontmatter `title` override, else the filename. */
  title: string
  /** Absolute path to the `.md` file. */
  path: string
  /** POSIX-style path of the containing folder, relative to the vault root ('' = root). */
  folder: string
  frontmatter: Record<string, unknown>
  doc: TTDoc
  /** ISO timestamps (frontmatter, reconciled with mtime for `updated`). */
  created: string
  updated: string
}

export interface VaultNoteSummary {
  id: string | null
  title: string
  path: string
  folder: string
  updated: string
  /** Derived from the extension. `'note'` is parsed; any other kind is an artifact. */
  kind: DocumentKind
}

// ---------------------------------------------------------------------------
// title <-> filename (Q7: filename is the title; frontmatter.title overrides)
// ---------------------------------------------------------------------------

export function titleFromFilename(filePath: string): string {
  // Strip the actual trailing extension (not just `.md`) so `report.html` and
  // `report.csv` display as "report" like `report.md` does. Notes always carry a
  // `.md` extension, so this is identical to the old `.md`-only strip for them.
  return basename(filePath).replace(/\.[^./\\]+$/, '')
}

/** Turn a desired title into a filesystem-legal filename stem. */
export function slugifyTitle(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'Untitled'
}

/** Pick a unique `<stem>.md` (or `<stem> 2.md`, ...) within a directory. */
export function uniqueNotePath(dir: string, stem: string): string {
  let candidate = join(dir, `${stem}.md`)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem} ${n}.md`)
    n++
  }
  return candidate
}

function resolveTitle(frontmatter: Record<string, unknown>, filePath: string): string {
  const override = frontmatter.title
  if (typeof override === 'string' && override.trim().length > 0) return override
  return titleFromFilename(filePath)
}

// ---------------------------------------------------------------------------
// frontmatter identity + timestamp backfill (Q3, Q8)
// ---------------------------------------------------------------------------

export interface BackfillResult {
  frontmatter: Record<string, unknown>
  changed: boolean
}

/**
 * Ensure a note's frontmatter carries id/created/updated. Foreign `.md` files
 * created outside Green Tea get these stamped on first open. `mtimeIso` is the
 * file's modification time, used as the default timestamp.
 */
export function backfillFrontmatter(
  frontmatter: Record<string, unknown>,
  mtimeIso: string
): BackfillResult {
  const next = { ...frontmatter }
  let changed = false

  if (typeof next.id !== 'string' || next.id.length === 0) {
    next.id = randomUUID()
    changed = true
  }
  if (typeof next.created !== 'string' || next.created.length === 0) {
    next.created = mtimeIso
    changed = true
  }
  if (typeof next.updated !== 'string' || next.updated.length === 0) {
    next.updated = mtimeIso
    changed = true
  }

  return { frontmatter: next, changed }
}

/** Reconcile the stored `updated` with the file mtime — the later wins (Q8). */
function reconcileUpdated(frontmatterUpdated: unknown, mtimeIso: string): string {
  if (typeof frontmatterUpdated !== 'string' || frontmatterUpdated.length === 0) return mtimeIso
  return frontmatterUpdated > mtimeIso ? frontmatterUpdated : mtimeIso
}

// ---------------------------------------------------------------------------
// read / write
// ---------------------------------------------------------------------------

/**
 * Read a note from disk into editor form. If the file was missing identity or
 * timestamps, they are backfilled AND written back (a one-time normalization),
 * unless `persistBackfill` is false.
 */
export function readNote(filePath: string, persistBackfill = true): VaultNote {
  const raw = readFileSync(filePath, 'utf-8')
  const stat = statSync(filePath)
  const mtimeIso = stat.mtime.toISOString()

  const { data: rawFm } = parseFrontmatter(raw)
  const { frontmatter, changed } = backfillFrontmatter(rawFm, mtimeIso)
  const { doc } = parseNoteFile(raw)

  if (changed && persistBackfill) {
    writeNote(filePath, { frontmatter, doc })
  }

  return {
    id: frontmatter.id as string,
    title: resolveTitle(frontmatter, filePath),
    path: filePath,
    folder: '',
    frontmatter,
    doc,
    created: (frontmatter.created as string) ?? mtimeIso,
    updated: reconcileUpdated(frontmatter.updated, mtimeIso)
  }
}

/**
 * Write `contents` to `filePath` atomically: write a temp file in the same
 * directory, then rename over the target. The rename is atomic on POSIX, so a
 * crash mid-write never leaves a half-written file and the watcher never
 * observes a partial one. Does NOT record a self-write — callers that need the
 * vault watcher to ignore their own bytes must `markSelfWrite` first (writeNote
 * does; the artifact write-back path does too).
 */
export function atomicWriteFile(filePath: string, contents: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.${basename(filePath)}.tmp-${randomUUID()}`)
  writeFileSync(tmp, contents, 'utf-8')
  renameSync(tmp, filePath)
}

/**
 * Write a note to disk atomically: serialize, mark the self-write so the vault
 * watcher recognizes its own bytes and doesn't echo-loop, then atomic-write.
 */
export function writeNote(filePath: string, note: NoteFile): void {
  const contents = serializeNoteFile(note)
  // Record this write (final path + exact bytes) so the vault watcher recognizes
  // the resulting filesystem event as our own and doesn't echo-loop on it.
  markSelfWrite(filePath, contents)
  atomicWriteFile(filePath, contents)
}

// ---------------------------------------------------------------------------
// listing / indexing
// ---------------------------------------------------------------------------

function isIgnored(name: string): boolean {
  return IGNORED_DIRS.has(name) || name.startsWith('.')
}

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/**
 * Recursively list every indexable file in a vault, cheaply. Notes (`.md`) are
 * read for frontmatter only (no body conversion); artifacts (html, …) are
 * metadata-only — the body is NEVER read here (path-based identity, see
 * documents-service). Honors the ignore-list and a per-kind size cap. An
 * extension not in `artifact-kinds` is skipped. Used to (re)build the derived
 * index.
 */
export function listVaultNotes(vaultDir: string): VaultNoteSummary[] {
  const out: VaultNoteSummary[] = []
  if (!existsSync(vaultDir)) return out

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isIgnored(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const kind = kindForExt(entry.name)
      if (!kind) continue

      const stat = statSync(full)
      const cap = maxBytesForKind(kind)
      if (stat.size > cap) {
        // Skipped for size — keep this greppable rather than silent.
        console.warn(`[vault] skipping ${full}: ${stat.size} bytes exceeds ${kind} cap ${cap}`)
        continue
      }
      const mtimeIso = stat.mtime.toISOString()
      const folderRel = toPosix(relative(vaultDir, dirname(full)))

      if (kind === 'note') {
        const { data: frontmatter } = parseFrontmatter(readFileSync(full, 'utf-8'))
        out.push({
          id: typeof frontmatter.id === 'string' ? frontmatter.id : null,
          title: resolveTitle(frontmatter, full),
          path: full,
          folder: folderRel,
          updated: reconcileUpdated(frontmatter.updated, mtimeIso),
          kind
        })
      } else {
        // Artifact: path-derived identity (id resolved by the indexer), title from
        // the filename, mtime as the change fingerprint. No body read.
        out.push({
          id: null,
          title: titleFromFilename(full),
          path: full,
          folder: folderRel,
          updated: mtimeIso,
          kind
        })
      }
    }
  }

  walk(vaultDir)
  return out
}

/**
 * List every (non-ignored) subdirectory in a vault as a POSIX slash-path relative
 * to the root, including EMPTY ones that `listVaultNotes` can't surface (it only
 * emits file entries). The indexer uses this so a folder with no notes still gets
 * a row — and so an empty subfolder survives a folder move/rename, where the
 * directory is relocated on disk but no note exists to re-derive its path.
 */
export function listVaultFolders(vaultDir: string): string[] {
  const out: string[] = []
  if (!existsSync(vaultDir)) return out

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || isIgnored(entry.name)) continue
      const full = join(dir, entry.name)
      out.push(toPosix(relative(vaultDir, full)))
      walk(full)
    }
  }

  walk(vaultDir)
  return out
}
