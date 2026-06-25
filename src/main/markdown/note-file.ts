import { parseFrontmatter, stringifyFrontmatter } from './frontmatter'
import { markdownToTiptap, tiptapToMarkdown, type TTDoc } from './tiptap-markdown'

/**
 * A parsed note file: its YAML frontmatter object plus the editor document.
 * The frontmatter is passed through verbatim (identity, title override,
 * timestamps) — this layer only owns the body <-> editor conversion.
 */
export interface NoteFile {
  frontmatter: Record<string, unknown>
  doc: TTDoc
}

/** Parse a raw `.md` file (frontmatter + markdown body) into editor form. */
export function parseNoteFile(raw: string): NoteFile {
  const { data, body } = parseFrontmatter(raw)
  return { frontmatter: data, doc: markdownToTiptap(body) }
}

/** Serialize editor form back into a raw `.md` file. */
export function serializeNoteFile(note: NoteFile): string {
  const body = tiptapToMarkdown(note.doc)
  return stringifyFrontmatter(note.frontmatter, body)
}
