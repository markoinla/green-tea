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
const MAX_NOTE_BYTES = 2 * 1024 * 1024

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
}

// ---------------------------------------------------------------------------
// title <-> filename (Q7: filename is the title; frontmatter.title overrides)
// ---------------------------------------------------------------------------

export function titleFromFilename(filePath: string): string {
  return basename(filePath).replace(/\.md$/i, '')
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
 * Write a note to disk atomically: serialize, write to a temp file in the same
 * directory, then rename over the target. The rename is atomic on POSIX, so a
 * crash mid-write never leaves a half-written note and the watcher never
 * observes a partial file.
 */
export function writeNote(filePath: string, note: NoteFile): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const contents = serializeNoteFile(note)
  const tmp = join(dir, `.${basename(filePath)}.tmp-${randomUUID()}`)
  writeFileSync(tmp, contents, 'utf-8')
  renameSync(tmp, filePath)
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
 * Recursively list every note in a vault, cheaply (frontmatter only — no body
 * conversion). Honors the ignore-list and the size cap. Used to (re)build the
 * derived index.
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
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue

      const stat = statSync(full)
      if (stat.size > MAX_NOTE_BYTES) continue
      const mtimeIso = stat.mtime.toISOString()

      const { data: frontmatter } = parseFrontmatter(readFileSync(full, 'utf-8'))
      const folderRel = toPosix(relative(vaultDir, dirname(full)))

      out.push({
        id: typeof frontmatter.id === 'string' ? frontmatter.id : null,
        title: resolveTitle(frontmatter, full),
        path: full,
        folder: folderRel,
        updated: reconcileUpdated(frontmatter.updated, mtimeIso)
      })
    }
  }

  walk(vaultDir)
  return out
}
