import { IMAGE_MIME_TYPES } from './chat-input-constants'

export type RichTextNode = Record<string, unknown>

export function walkRichText(node: RichTextNode, visitor: (node: RichTextNode) => void): void {
  visitor(node)
  if (!Array.isArray(node.content)) return
  node.content.forEach((child: RichTextNode) => walkRichText(child, visitor))
}

export function isImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.includes(mimeType)
}
