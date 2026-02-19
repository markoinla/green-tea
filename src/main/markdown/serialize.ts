import type { SerializableBlock } from './types'

function serializeBlock(block: SerializableBlock, indent: number, needsPrefix: boolean): string {
  const indentStr = '  '.repeat(indent)
  const prefix = needsPrefix ? '- ' : ''
  let line: string

  switch (block.type) {
    case 'heading1':
      line = `${indentStr}${prefix}# ${block.content}`
      break
    case 'heading2':
      line = `${indentStr}${prefix}## ${block.content}`
      break
    case 'heading3':
      line = `${indentStr}${prefix}### ${block.content}`
      break
    case 'heading4':
      line = `${indentStr}${prefix}#### ${block.content}`
      break
    case 'heading5':
      line = `${indentStr}${prefix}##### ${block.content}`
      break
    case 'task_item':
      if (needsPrefix) {
        line = block.checked
          ? `${indentStr}- [x] ${block.content}`
          : `${indentStr}- [ ] ${block.content}`
      } else {
        line = block.checked
          ? `${indentStr}[x] ${block.content}`
          : `${indentStr}[ ] ${block.content}`
      }
      break
    case 'code_block':
      line = `${indentStr}${prefix}\`\`\`\n${block.content
        .split('\n')
        .map((l) => `${indentStr}${needsPrefix ? '  ' : ''}${l}`)
        .join('\n')}\n${indentStr}${needsPrefix ? '  ' : ''}\`\`\``
      break
    case 'blockquote':
      line = `${indentStr}${prefix}> ${block.content}`
      break
    case 'table': {
      if (block.rows && block.rows.length > 0) {
        const colCount = Math.max(...block.rows.map((r) => r.length))
        // Calculate column widths
        const colWidths: number[] = []
        for (let c = 0; c < colCount; c++) {
          colWidths[c] = Math.max(3, ...block.rows.map((r) => (r[c] ?? '').length))
        }
        const formatRow = (row: string[]): string => {
          const cells = Array.from({ length: colCount }, (_, c) =>
            (row[c] ?? '').padEnd(colWidths[c])
          )
          return `${indentStr}| ${cells.join(' | ')} |`
        }
        const tableLines: string[] = []
        // Header row
        tableLines.push(formatRow(block.rows[0]))
        // Separator
        const sep = colWidths.map((w) => '-'.repeat(w))
        tableLines.push(`${indentStr}| ${sep.join(' | ')} |`)
        // Data rows
        for (let r = 1; r < block.rows.length; r++) {
          tableLines.push(formatRow(block.rows[r]))
        }
        line = tableLines.join('\n')
      } else {
        line = ''
      }
      break
    }
    case 'image':
      line = `${indentStr}${prefix}![${block.alt ?? ''}](${block.src ?? ''})`
      break
    case 'paragraph':
    default:
      line = `${indentStr}${prefix}${block.content}`
      break
  }

  const lines = [line]

  for (const child of block.children) {
    lines.push(serializeBlock(child, indent + 1, true))
  }

  return lines.join('\n')
}

export function serializeBlocks(blocks: SerializableBlock[]): string {
  const results: string[] = []

  for (const block of blocks) {
    const needsPrefix = block.isList === true || block.children.length > 0
    results.push(serializeBlock(block, 0, needsPrefix))
  }

  return results.join('\n\n')
}
