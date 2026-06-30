/**
 * Pure helpers for rendering the per-note git history panel (Phase 1, §5). Kept in
 * a plain `.ts` module (no React, no `window.api`) so they are unit-testable under
 * the node-environment vitest include glob (`*.test.ts`).
 *
 * The diff itself is produced main-side by `git-service.diffForPath`, which has no
 * `isomorphic-git` diff API and instead formats a unified patch with the `diff`
 * package (`createTwoFilesPatch`). Here we only classify each already-formatted line
 * for coloring — no diffing logic lives in the renderer.
 */

export type DiffLineType = 'add' | 'del' | 'hunk' | 'header' | 'meta' | 'context'

export interface DiffLine {
  type: DiffLineType
  text: string
}

/** Classify a single unified-diff line for coloring. */
export function classifyDiffLine(line: string): DiffLineType {
  // File headers (`--- old` / `+++ new`) must be checked before the generic
  // single-char `+`/`-` add/del cases, since they also start with those chars.
  if (line.startsWith('+++') || line.startsWith('---')) return 'header'
  if (line.startsWith('@@')) return 'hunk'
  // `createTwoFilesPatch` preamble (`Index:` + the `===` rule) and the
  // "\ No newline at end of file" marker carry no +/- content.
  if (line.startsWith('Index:') || line.startsWith('====') || line.startsWith('\\')) return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'context'
}

/**
 * Split a unified patch string into classified lines for the diff view. A trailing
 * newline is dropped so it doesn't render as a spurious empty context row. An empty
 * patch (no textual change between the ref and the working tree) yields `[]`.
 */
export function parseDiffLines(patch: string): DiffLine[] {
  if (!patch) return []
  const text = patch.endsWith('\n') ? patch.slice(0, -1) : patch
  return text.split('\n').map((line) => ({ type: classifyDiffLine(line), text: line }))
}

/** Whether a patch contains any real add/del rows (vs. only headers/context). */
export function hasChanges(patch: string): boolean {
  return parseDiffLines(patch).some((l) => l.type === 'add' || l.type === 'del')
}
