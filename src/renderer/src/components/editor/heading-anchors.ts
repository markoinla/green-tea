import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

// Heading anchors let `[[#Heading]]` links jump to a section within the same
// note. Sections are addressed by their heading text — normalized to a slug so
// small differences (case, spacing, punctuation) still match — rather than by a
// synthetic id, so the link survives the markdown round-trip as plain text.

/** Normalize heading text for anchor matching. Symmetric on both sides. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
}

export interface HeadingEntry {
  text: string
  level: number
  /** Position of the heading node, for resolving to a DOM node to scroll to. */
  pos: number
}

/**
 * Collect every heading in the doc, in document order. Handles BOTH shapes a
 * heading takes in this editor:
 *  - a real `heading` node (created live via `setHeading`), and
 *  - an `outlinerItem` whose `blockType` is `heading1`..`heading6` (the form
 *    produced when markdown headings-in-lists are loaded). For those we take the
 *    item's OWN leading text (its first child), NOT `node.textContent`, which
 *    would also fold in nested sub-items.
 */
export function collectHeadings(doc: ProseMirrorNode): HeadingEntry[] {
  const out: HeadingEntry[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({ text: node.textContent, level: (node.attrs.level as number) ?? 1, pos })
      return false // a heading has no nested headings inside it
    }
    const blockType = node.attrs?.blockType
    if (
      node.type.name === 'outlinerItem' &&
      typeof blockType === 'string' &&
      blockType.startsWith('heading')
    ) {
      const lead = node.firstChild
      out.push({
        text: lead ? lead.textContent : '',
        level: parseInt(blockType.slice('heading'.length), 10) || 1,
        pos
      })
    }
    return true
  })
  return out
}
