import { randomUUID } from 'crypto'
import type { SerializableBlock } from './types'

interface ParsedLine {
  indent: number
  type: SerializableBlock['type']
  content: string
  checked?: boolean
  isList?: boolean
  src?: string
  alt?: string
}

function parseLine(line: string): ParsedLine {
  // Measure leading spaces
  const stripped = line.replace(/^ */, '')
  const indent = line.length - stripped.length
  const indentLevel = Math.floor(indent / 2)

  // Remove optional list prefix "- "
  let rest = stripped
  let hadListPrefix = false
  if (rest.startsWith('- ')) {
    rest = rest.slice(2)
    hadListPrefix = true
  }

  // Detect block type by prefix
  if (rest.startsWith('# ')) {
    return { indent: indentLevel, type: 'heading1', content: rest.slice(2), isList: hadListPrefix }
  }
  if (rest.startsWith('## ')) {
    return { indent: indentLevel, type: 'heading2', content: rest.slice(3), isList: hadListPrefix }
  }
  if (rest.startsWith('### ')) {
    return { indent: indentLevel, type: 'heading3', content: rest.slice(4), isList: hadListPrefix }
  }
  if (rest.startsWith('#### ')) {
    return { indent: indentLevel, type: 'heading4', content: rest.slice(5), isList: hadListPrefix }
  }
  if (rest.startsWith('##### ')) {
    return { indent: indentLevel, type: 'heading5', content: rest.slice(6), isList: hadListPrefix }
  }
  if (rest.startsWith('[x] ')) {
    return {
      indent: indentLevel,
      type: 'task_item',
      content: rest.slice(4),
      checked: true,
      isList: true
    }
  }
  if (rest.startsWith('[ ] ')) {
    return {
      indent: indentLevel,
      type: 'task_item',
      content: rest.slice(4),
      checked: false,
      isList: true
    }
  }
  if (rest.startsWith('> ')) {
    return {
      indent: indentLevel,
      type: 'blockquote',
      content: rest.slice(2),
      isList: hadListPrefix
    }
  }

  // Image: ![alt](src)
  const imageMatch = rest.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
  if (imageMatch) {
    return {
      indent: indentLevel,
      type: 'image',
      content: '',
      alt: imageMatch[1],
      src: imageMatch[2],
      isList: hadListPrefix
    }
  }

  // Plain paragraph (or list item content)
  return {
    indent: indentLevel,
    type: 'paragraph',
    content: hadListPrefix ? rest : stripped,
    isList: hadListPrefix
  }
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|')
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false
  // Separator row: cells contain only dashes, colons, and spaces (e.g. | --- | :---: |)
  const cells = trimmed.slice(1, -1).split('|')
  return cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell))
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim()
  // Strip leading and trailing |
  const inner = trimmed.slice(1, -1)
  return inner.split('|').map((cell) => cell.trim())
}

function collectTableRows(
  lines: string[],
  startIndex: number
): { rows: string[][]; endIndex: number } {
  const rows: string[][] = []
  let i = startIndex

  while (i < lines.length && isTableRow(lines[i])) {
    if (!isTableSeparator(lines[i])) {
      rows.push(parseTableCells(lines[i]))
    }
    i++
  }

  return { rows, endIndex: i - 1 }
}

function collectCodeBlockContent(
  lines: string[],
  startIndex: number,
  baseIndent: number,
  hasListPrefix: boolean
): { content: string; endIndex: number } {
  const contentLines: string[] = []
  const contentIndent = baseIndent + (hasListPrefix ? 2 : 0)
  let i = startIndex

  while (i < lines.length) {
    const raw = lines[i]
    // Strip the content-level indent
    const stripped = raw.length >= contentIndent ? raw.slice(contentIndent) : raw.trimStart()

    if (stripped.startsWith('```')) {
      // Closing fence
      return { content: contentLines.join('\n'), endIndex: i }
    }

    contentLines.push(stripped)
    i++
  }

  // If no closing fence found, return what we have
  return { content: contentLines.join('\n'), endIndex: i - 1 }
}

export function deserializeMarkdown(markdown: string): SerializableBlock[] {
  const lines = markdown.split('\n')
  const roots: SerializableBlock[] = []

  // Stack to track parent at each indent level
  const stack: { block: SerializableBlock; indent: number }[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Skip blank lines
    if (line.trim() === '') {
      i++
      continue
    }

    // Check for markdown table
    if (isTableRow(line)) {
      const { rows, endIndex } = collectTableRows(lines, i)
      if (rows.length > 0) {
        const block: SerializableBlock = {
          id: randomUUID(),
          type: 'table',
          content: '',
          rows,
          children: []
        }
        roots.push(block)
        i = endIndex + 1
        continue
      }
    }

    // Check for code block opening fence
    const stripped = line.replace(/^ */, '')
    const leadingSpaces = line.length - stripped.length
    const indentLevel = Math.floor(leadingSpaces / 2)

    let rest = stripped
    let hasListPrefix = false
    if (rest.startsWith('- ')) {
      rest = rest.slice(2)
      hasListPrefix = true
    }

    if (rest.startsWith('```')) {
      // Code block
      const { content, endIndex } = collectCodeBlockContent(
        lines,
        i + 1,
        leadingSpaces,
        hasListPrefix
      )
      const block: SerializableBlock = {
        id: randomUUID(),
        type: 'code_block',
        content,
        isList: hasListPrefix,
        children: []
      }

      insertBlock(roots, stack, block, indentLevel)
      i = endIndex + 1
      continue
    }

    // Normal line
    const parsed = parseLine(line)
    const block: SerializableBlock = {
      id: randomUUID(),
      type: parsed.type,
      content: parsed.content,
      isList: parsed.isList,
      children: []
    }
    if (parsed.checked !== undefined) {
      block.checked = parsed.checked
    }
    if (parsed.src !== undefined) {
      block.src = parsed.src
    }
    if (parsed.alt !== undefined) {
      block.alt = parsed.alt
    }

    insertBlock(roots, stack, block, parsed.indent)
    i++
  }

  return roots
}

function insertBlock(
  roots: SerializableBlock[],
  stack: { block: SerializableBlock; indent: number }[],
  block: SerializableBlock,
  indent: number
): void {
  // Pop stack entries that are at same level or deeper
  while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
    stack.pop()
  }

  if (stack.length === 0) {
    // Top-level block
    roots.push(block)
  } else {
    // Child of the last block on the stack
    stack[stack.length - 1].block.children.push(block)
  }

  stack.push({ block, indent })
}
