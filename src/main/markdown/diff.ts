import { createPatch, applyPatch } from 'diff'

export function createMarkdownDiff(oldMarkdown: string, newMarkdown: string): string {
  return createPatch('document.md', oldMarkdown, newMarkdown, '', '', { context: 3 })
}

export function applyMarkdownDiff(markdown: string, patch: string): string {
  const result = applyPatch(markdown, patch)
  if (result === false) {
    throw new Error('Failed to apply patch: patch does not match the source text')
  }
  return result
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: { type: 'add' | 'remove' | 'context'; content: string }[]
}

export function parseDiffHunks(patch: string): DiffHunk[] {
  const lines = patch.split('\n')
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null

  for (const line of lines) {
    // Match hunk header: @@ -oldStart,oldLines +newStart,newLines @@
    const hunkHeader = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/)
    if (hunkHeader) {
      currentHunk = {
        oldStart: parseInt(hunkHeader[1], 10),
        oldLines: hunkHeader[2] ? parseInt(hunkHeader[2], 10) : 1,
        newStart: parseInt(hunkHeader[3], 10),
        newLines: hunkHeader[4] ? parseInt(hunkHeader[4], 10) : 1,
        lines: []
      }
      hunks.push(currentHunk)
      continue
    }

    if (!currentHunk) continue

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1) })
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'remove', content: line.slice(1) })
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({ type: 'context', content: line.slice(1) })
    }
    // Skip lines that don't match (e.g., "\ No newline at end of file")
  }

  return hunks
}
