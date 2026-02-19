import { randomUUID } from 'crypto'
import type { SerializableBlock } from './types'

interface TipTapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

function extractInlineText(nodes: TipTapNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === 'text') {
        let text = n.text ?? ''
        for (const mark of n.marks ?? []) {
          switch (mark.type) {
            case 'bold':
              text = `**${text}**`
              break
            case 'italic':
              text = `*${text}*`
              break
            case 'code':
              text = `\`${text}\``
              break
            case 'strike':
              text = `~~${text}~~`
              break
            case 'link': {
              const href = mark.attrs?.href as string
              if (href) {
                text = `[${text}](${href})`
              }
              break
            }
          }
        }
        return text
      }
      // Recurse into nested content (e.g., paragraph inside blockquote)
      return n.content ? extractInlineText(n.content) : ''
    })
    .join('')
}

function tiptapNodeToBlock(node: TipTapNode): SerializableBlock | null {
  switch (node.type) {
    case 'paragraph':
      return {
        id: randomUUID(),
        type: 'paragraph',
        content: node.content ? extractInlineText(node.content) : '',
        children: []
      }

    case 'heading': {
      const level = (node.attrs?.level as number) ?? 1
      const headingMap: Record<number, SerializableBlock['type']> = {
        1: 'heading1',
        2: 'heading2',
        3: 'heading3',
        4: 'heading4',
        5: 'heading5'
      }
      const type = headingMap[level] ?? 'heading3'
      return {
        id: randomUUID(),
        type,
        content: node.content ? extractInlineText(node.content) : '',
        children: []
      }
    }

    case 'codeBlock':
      return {
        id: randomUUID(),
        type: 'code_block',
        content: node.content ? extractInlineText(node.content) : '',
        children: []
      }

    case 'blockquote':
      return {
        id: randomUUID(),
        type: 'blockquote',
        content: node.content ? extractInlineText(node.content) : '',
        children: []
      }

    case 'table': {
      const rows: string[][] = []
      for (const row of node.content ?? []) {
        if (row.type !== 'tableRow') continue
        const cells: string[] = []
        for (const cell of row.content ?? []) {
          if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue
          cells.push(cell.content ? extractInlineText(cell.content) : '')
        }
        rows.push(cells)
      }
      return {
        id: randomUUID(),
        type: 'table',
        content: '',
        rows,
        children: []
      }
    }

    case 'image':
      return {
        id: randomUUID(),
        type: 'image',
        content: '',
        src: node.attrs?.src as string,
        alt: (node.attrs?.alt as string) ?? '',
        children: []
      }

    case 'outlinerItem': {
      const blockType = (node.attrs?.blockType as string) ?? 'paragraph'
      const checked = (node.attrs?.checked as boolean) ?? false
      const contentNode = node.content?.[0]
      const childList = node.content?.find((c) => c.type === 'outlinerList')

      const content = contentNode?.content ? extractInlineText(contentNode.content) : ''
      const children =
        childList?.content
          ?.map(tiptapNodeToBlock)
          .filter((b): b is SerializableBlock => b !== null) ?? []

      const block: SerializableBlock = {
        id: randomUUID(),
        type: blockType as SerializableBlock['type'],
        content,
        isList: true,
        children
      }
      if (blockType === 'task_item') {
        block.checked = checked
      }
      return block
    }

    default:
      return null
  }
}

export function tiptapJsonToBlocks(jsonStr: string): SerializableBlock[] {
  let doc: TipTapNode
  try {
    doc = JSON.parse(jsonStr) as TipTapNode
  } catch {
    return []
  }

  if (doc.type !== 'doc' || !doc.content) return []

  const blocks: SerializableBlock[] = []
  for (const node of doc.content) {
    if (node.type === 'outlinerList') {
      for (const item of node.content ?? []) {
        const block = tiptapNodeToBlock(item)
        if (block) blocks.push(block)
      }
    } else {
      const block = tiptapNodeToBlock(node)
      if (block) blocks.push(block)
    }
  }
  return blocks
}
