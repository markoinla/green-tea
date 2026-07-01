import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

/**
 * Bidirectional converter between the TipTap outliner document JSON and
 * CommonMark+GFM markdown text. This is the keystone of the markdown-on-disk
 * feature: `tiptapToMarkdown` produces the file on disk, `markdownToTiptap`
 * loads it back into the editor.
 *
 * Design notes:
 * - Parsing/stringifying CommonMark is delegated entirely to the battle-tested
 *   mdast pipeline (`mdast-util-from-markdown` / `mdast-util-to-markdown` + gfm).
 *   We never hand-roll markdown — that is the only way to make the round-trip a
 *   stable fixed point.
 * - The outliner's nesting maps onto GFM nested lists. Top-level headings,
 *   paragraphs, blockquotes, code, tables, etc. map onto their native mdast
 *   block nodes, so a normal note reads as normal markdown in any tool.
 * - Highlight and underline have no CommonMark syntax, so they are encoded as
 *   inline HTML (`<mark>…</mark>`, `<u>…</u>`) — valid, portable, and renders in
 *   Obsidian/GitHub. Both use one uniform open/close-tag mechanism.
 * - Collapse state and block IDs are intentionally NOT written to the file; they
 *   are editor view-state stored elsewhere (per the design doc).
 * - Wiki-links (`wikiLink` nodes) are written as literal `[[Label]]` text — the
 *   human-readable title only, so the file stays portable/Obsidian-compatible.
 *   The resolved `docId` is intentionally NOT written to disk; it is re-resolved
 *   from the title in the service layer on load (see documents-service). On read,
 *   `[[Label]]` text is parsed back into a `wikiLink` node with `docId: null`
 *   (this converter is workspace-agnostic and pure — no DB access here).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TTMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface TTNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TTNode[]
  text?: string
  marks?: TTMark[]
}

export interface TTDoc {
  type: 'doc'
  content: TTNode[]
}

// Permissive mdast node — we avoid fighting @types/mdast's strict unions and
// treat the tree structurally.
interface MdNode {
  type: string
  children?: MdNode[]
  value?: string
  depth?: number
  ordered?: boolean
  start?: number | null
  spread?: boolean
  checked?: boolean | null
  lang?: string | null
  meta?: string | null
  url?: string
  title?: string | null
  alt?: string | null
  identifier?: string
  align?: (string | null)[]
  [key: string]: unknown
}

const HEADING_TYPES = new Set([
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6'
])

// ---------------------------------------------------------------------------
// markdown -> TipTap
// ---------------------------------------------------------------------------

export function markdownToTiptap(markdown: string): TTDoc {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  }) as unknown as MdNode

  const content = blocksToTipTap(tree.children ?? [])
  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }]
  }
}

function blocksToTipTap(nodes: MdNode[]): TTNode[] {
  const out: TTNode[] = []
  for (const node of nodes) {
    const mapped = blockToTipTap(node)
    if (Array.isArray(mapped)) out.push(...mapped)
    else if (mapped) out.push(mapped)
  }
  return out
}

function blockToTipTap(node: MdNode): TTNode | TTNode[] | null {
  switch (node.type) {
    case 'heading': {
      const level = clampHeading(node.depth ?? 1)
      return paragraphOrNode('heading', { level }, inlineToTipTap(node.children ?? []))
    }

    case 'paragraph': {
      const kids = node.children ?? []
      // A paragraph that is just a single image becomes a block image node.
      if (kids.length === 1 && kids[0].type === 'image') {
        return imageToTipTap(kids[0])
      }
      const content = inlineToTipTap(kids)
      return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
    }

    case 'blockquote':
      return { type: 'blockquote', content: blocksToTipTap(node.children ?? []) }

    case 'code': {
      const text = node.value ?? ''
      return {
        type: 'codeBlock',
        attrs: { language: node.lang ?? null },
        content: text.length > 0 ? [{ type: 'text', text }] : []
      }
    }

    case 'thematicBreak':
      return { type: 'horizontalRule' }

    case 'list':
      return listToTipTap(node)

    case 'table':
      return tableToTipTap(node)

    case 'image':
      return imageToTipTap(node)

    case 'html':
      // Block-level raw HTML — keep the text so nothing is silently dropped.
      return { type: 'paragraph', content: [{ type: 'text', text: node.value ?? '' }] }

    default:
      if (node.children) {
        const content = inlineToTipTap(node.children)
        return content.length > 0 ? { type: 'paragraph', content } : null
      }
      return null
  }
}

function listToTipTap(node: MdNode): TTNode {
  const ordered = node.ordered === true
  const items = (node.children ?? []).map((item) => listItemToTipTap(item))
  return {
    type: ordered ? 'outlinerOrderedList' : 'outlinerList',
    content: items
  }
}

function listItemToTipTap(item: MdNode): TTNode {
  const children = item.children ?? []
  let blockType = 'paragraph'
  let leadInline: TTNode[] = []
  let leadConsumed = false
  const nested: TTNode[] = []

  for (const child of children) {
    if (child.type === 'list') {
      nested.push(listToTipTap(child))
      continue
    }
    if (leadConsumed) {
      // The outliner model holds one lead block + nested lists. Extra sibling
      // blocks are rare; fold their text into the lead so nothing is lost.
      leadInline = leadInline.concat(inlineToTipTap(child.children ?? []))
      continue
    }
    leadConsumed = true
    switch (child.type) {
      case 'heading':
        blockType = `heading${clampHeading(child.depth ?? 1)}`
        leadInline = inlineToTipTap(child.children ?? [])
        break
      case 'code':
        blockType = 'code_block'
        leadInline = child.value ? [{ type: 'text', text: child.value }] : []
        break
      case 'blockquote':
        blockType = 'blockquote'
        leadInline = inlineToTipTap(firstChildInline(child))
        break
      default:
        leadInline = inlineToTipTap(child.children ?? [])
    }
  }

  const isTask = typeof item.checked === 'boolean'
  if (isTask) blockType = 'task_item'

  const attrs: Record<string, unknown> = { blockType }
  if (isTask) attrs.checked = item.checked === true

  const paragraph: TTNode =
    leadInline.length > 0 ? { type: 'paragraph', content: leadInline } : { type: 'paragraph' }

  return { type: 'outlinerItem', attrs, content: [paragraph, ...nested] }
}

function tableToTipTap(node: MdNode): TTNode {
  const rows = node.children ?? []
  const content = rows.map((row, rowIndex) => ({
    type: 'tableRow',
    content: (row.children ?? []).map((cell) => ({
      type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
      content: [{ type: 'paragraph', content: inlineToTipTap(cell.children ?? []) }]
    }))
  }))
  return {
    type: 'table',
    attrs: { align: node.align ?? [] },
    content
  }
}

function imageToTipTap(node: MdNode): TTNode {
  const attrs: Record<string, unknown> = { src: node.url ?? '' }
  if (node.alt != null) attrs.alt = node.alt
  if (node.title != null) attrs.title = node.title
  return { type: 'image', attrs }
}

// ---------------------------------------------------------------------------
// markdown inline -> TipTap inline (with mark accumulation)
// ---------------------------------------------------------------------------

const OPEN_MARK_HTML: Record<string, string> = { '<u>': 'underline', '<mark>': 'highlight' }
const CLOSE_MARK_HTML: Record<string, string> = { '</u>': 'underline', '</mark>': 'highlight' }

function inlineToTipTap(nodes: MdNode[], inherited: TTMark[] = []): TTNode[] {
  const out: TTNode[] = []
  let htmlMarks: TTMark[] = []

  for (const node of nodes) {
    if (node.type === 'html') {
      const tag = (node.value ?? '').trim().toLowerCase()
      if (OPEN_MARK_HTML[tag]) {
        htmlMarks = [...htmlMarks, { type: OPEN_MARK_HTML[tag] }]
        continue
      }
      if (CLOSE_MARK_HTML[tag]) {
        htmlMarks = removeLastMark(htmlMarks, CLOSE_MARK_HTML[tag])
        continue
      }
      pushText(out, node.value ?? '', mergeMarks(inherited, htmlMarks))
      continue
    }

    const marks = mergeMarks(inherited, htmlMarks)
    switch (node.type) {
      case 'text':
        pushText(out, node.value ?? '', marks)
        break
      case 'strong':
        out.push(...inlineToTipTap(node.children ?? [], addMark(marks, { type: 'bold' })))
        break
      case 'emphasis':
        out.push(...inlineToTipTap(node.children ?? [], addMark(marks, { type: 'italic' })))
        break
      case 'delete':
        out.push(...inlineToTipTap(node.children ?? [], addMark(marks, { type: 'strike' })))
        break
      case 'inlineCode':
        pushText(out, node.value ?? '', addMark(marks, { type: 'code' }))
        break
      case 'link': {
        const attrs: Record<string, unknown> = { href: node.url ?? '' }
        if (node.title != null) attrs.title = node.title
        out.push(...inlineToTipTap(node.children ?? [], addMark(marks, { type: 'link', attrs })))
        break
      }
      case 'break':
        out.push({ type: 'hardBreak' })
        break
      case 'image':
        // Inline image — degrade to its alt text (block images are handled above).
        pushText(out, node.alt ?? '', marks)
        break
      default:
        if (node.children) out.push(...inlineToTipTap(node.children, marks))
    }
  }

  return mergeAdjacentText(out)
}

function pushText(out: TTNode[], text: string, marks: TTMark[]): void {
  if (text.length === 0) return
  for (const node of splitWikiLinks(text, marks)) out.push(node)
}

// `mdast` has no concept of `[[wiki-links]]`, so they arrive as plain text. Split
// a text run on the `[[Label]]` / `[[Label#Anchor]]` pattern, emitting `wikiLink`
// nodes (docId null — title->id resolution happens in the service layer)
// interleaved with the surrounding text runs, which keep the same marks. A
// `wikiLink` round-trips back to `[[Label]]` (see inlineToMd), so this split is
// the exact inverse. The label group is `*` (not `+`) so a same-note anchor
// `[[#Heading]]` (empty label) parses too; the anchor group is optional so a
// plain `[[Label]]` still matches with anchor undefined. A note title containing
// `#` is split at the first `#` — an inherent ambiguity of the Obsidian syntax.
const WIKI_LINK_RE = /\[\[([^[\]#]*)(?:#([^[\]]+))?\]\]/g

function splitWikiLinks(text: string, marks: TTMark[]): TTNode[] {
  const out: TTNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  WIKI_LINK_RE.lastIndex = 0
  while ((match = WIKI_LINK_RE.exec(text)) !== null) {
    // Degenerate `[[]]` (empty label, no anchor) isn't a link — keep it literal.
    if (match[1] === '' && !match[2]) continue
    if (match.index > last) {
      out.push(textNode(text.slice(last, match.index), marks))
    }
    out.push({
      type: 'wikiLink',
      attrs: { label: match[1], docId: null, anchor: match[2] ?? null }
    })
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(textNode(text.slice(last), marks))
  return out
}

function textNode(text: string, marks: TTMark[]): TTNode {
  const node: TTNode = { type: 'text', text }
  if (marks.length > 0) node.marks = marks
  return node
}

// ---------------------------------------------------------------------------
// TipTap -> markdown
// ---------------------------------------------------------------------------

export function tiptapToMarkdown(doc: TTDoc | TTNode): string {
  const content = doc.content ?? []
  const children: MdNode[] = []
  for (const node of content) {
    const mapped = tiptapBlockToMd(node)
    if (Array.isArray(mapped)) children.push(...mapped)
    else if (mapped) children.push(mapped)
  }

  const tree: MdNode = { type: 'root', children }
  return toMarkdown(tree as never, {
    extensions: [gfmToMarkdown()],
    bullet: '-',
    listItemIndent: 'one',
    rule: '-',
    ruleRepetition: 3,
    fences: true,
    incrementListMarker: true,
    resourceLink: false
  })
}

function tiptapBlockToMd(node: TTNode): MdNode | MdNode[] | null {
  switch (node.type) {
    case 'heading':
      return {
        type: 'heading',
        depth: clampHeading((node.attrs?.level as number) ?? 1),
        children: inlineToMd(node.content ?? [])
      }

    case 'paragraph':
      return { type: 'paragraph', children: inlineToMd(node.content ?? []) }

    case 'blockquote':
      return { type: 'blockquote', children: tiptapBlocksToMd(node.content ?? []) }

    case 'codeBlock':
      return {
        type: 'code',
        lang: (node.attrs?.language as string) ?? null,
        value: textOf(node.content ?? [])
      }

    case 'horizontalRule':
      return { type: 'thematicBreak' }

    case 'image':
      return { type: 'paragraph', children: [imageToMd(node)] }

    case 'outlinerList':
    case 'bulletList':
      return { type: 'list', ordered: false, spread: false, children: listItemsToMd(node) }

    case 'outlinerOrderedList':
    case 'orderedList':
      return { type: 'list', ordered: true, start: 1, spread: false, children: listItemsToMd(node) }

    case 'taskList':
      return { type: 'list', ordered: false, spread: false, children: listItemsToMd(node) }

    case 'table':
      return tableToMd(node)

    default:
      return null
  }
}

function tiptapBlocksToMd(nodes: TTNode[]): MdNode[] {
  const out: MdNode[] = []
  for (const node of nodes) {
    const mapped = tiptapBlockToMd(node)
    if (Array.isArray(mapped)) out.push(...mapped)
    else if (mapped) out.push(mapped)
  }
  return out
}

function listItemsToMd(list: TTNode): MdNode[] {
  return (list.content ?? []).map((item) => listItemToMd(item))
}

function listItemToMd(item: TTNode): MdNode {
  const blockType = (item.attrs?.blockType as string) ?? 'paragraph'
  const children = item.content ?? []
  const lead = children[0]
  const leadInline = lead?.content ?? []
  const nested = children
    .slice(1)
    .filter((c) => c.type === 'outlinerList' || c.type === 'outlinerOrderedList')

  let leadNode: MdNode
  if (HEADING_TYPES.has(blockType)) {
    leadNode = {
      type: 'heading',
      depth: clampHeading(parseInt(blockType.replace('heading', ''), 10) || 1),
      children: inlineToMd(leadInline)
    }
  } else if (blockType === 'code_block') {
    leadNode = { type: 'code', lang: null, value: textOf(leadInline) }
  } else if (blockType === 'blockquote') {
    leadNode = {
      type: 'blockquote',
      children: [{ type: 'paragraph', children: inlineToMd(leadInline) }]
    }
  } else {
    leadNode = { type: 'paragraph', children: inlineToMd(leadInline) }
  }

  const listItem: MdNode = {
    type: 'listItem',
    spread: false,
    children: [leadNode, ...tiptapBlocksToMd(nested)]
  }

  const isTask = blockType === 'task_item' || typeof item.attrs?.checked === 'boolean'
  if (isTask) listItem.checked = item.attrs?.checked === true

  return listItem
}

function tableToMd(node: TTNode): MdNode {
  const rows = (node.content ?? []).map((row) => ({
    type: 'tableRow',
    children: (row.content ?? []).map((cell) => ({
      type: 'tableCell',
      children: inlineToMd(cell.content?.[0]?.content ?? [])
    }))
  }))
  return {
    type: 'table',
    align: (node.attrs?.align as (string | null)[]) ?? [],
    children: rows
  }
}

function imageToMd(node: TTNode): MdNode {
  const md: MdNode = { type: 'image', url: (node.attrs?.src as string) ?? '' }
  md.alt = (node.attrs?.alt as string) ?? null
  if (node.attrs?.title != null) md.title = node.attrs.title as string
  return md
}

// ---------------------------------------------------------------------------
// TipTap inline -> markdown inline (run grouping + mark nesting)
// ---------------------------------------------------------------------------

// Mark nesting precedence, outermost -> innermost. A shared outer mark across
// several runs is emitted ONCE as a wrapper (e.g. `~~a **b** c~~`) rather than
// repeated per run (`~~a~~~~**b**~~~~c~~`), which would create delimiter
// collisions (`~~~~`) that re-parse differently and break idempotency.
const MARK_ORDER = ['link', 'highlight', 'underline', 'strike', 'bold', 'italic', 'code']

type InlineRun =
  | { text: string; marks: TTMark[] }
  | { hardBreak: true }
  | { wikiLabel: string; wikiAnchor: string | null }

function markRank(mark: TTMark): number {
  const i = MARK_ORDER.indexOf(mark.type)
  return i === -1 ? MARK_ORDER.length : i
}

function inlineToMd(nodes: TTNode[]): MdNode[] {
  const runs: InlineRun[] = []
  for (const node of nodes) {
    if (node.type === 'hardBreak') runs.push({ hardBreak: true })
    else if (node.type === 'text') runs.push({ text: node.text ?? '', marks: node.marks ?? [] })
    else if (node.type === 'wikiLink') {
      // A wiki-link serializes to literal `[[Label]]` (or `[[Label#Anchor]]`)
      // text. The docId is not written — it is re-resolved from the title on
      // load. The anchor (a heading text) rides along in the literal text.
      runs.push({
        wikiLabel: (node.attrs?.label as string) ?? '',
        wikiAnchor: (node.attrs?.anchor as string | null) ?? null
      })
    }
  }
  return buildInline(runs)
}

function buildInline(runs: InlineRun[]): MdNode[] {
  const out: MdNode[] = []
  let i = 0
  while (i < runs.length) {
    const run = runs[i]
    if ('hardBreak' in run) {
      out.push({ type: 'break' })
      i++
      continue
    }
    if ('wikiLabel' in run) {
      // Emit as a raw `html` node so mdast passes `[[Label]]` through verbatim
      // (a plain text node would escape the brackets to `\[\[`). On reparse the
      // `[[Label]]` text is split back into a wikiLink node (see splitWikiLinks).
      const inner = run.wikiAnchor ? `${run.wikiLabel}#${run.wikiAnchor}` : run.wikiLabel
      out.push({ type: 'html', value: `[[${inner}]]` })
      i++
      continue
    }
    if (run.marks.length === 0) {
      out.push({ type: 'text', value: run.text })
      i++
      continue
    }
    // Factor out the outermost mark and the maximal run of following nodes that
    // also carry it, then recurse on the remaining (inner) marks.
    const outer = [...run.marks].sort((a, b) => markRank(a) - markRank(b))[0]
    const group: InlineRun[] = []
    let j = i
    while (j < runs.length) {
      const r = runs[j]
      if ('hardBreak' in r || 'wikiLabel' in r) break
      if (!r.marks.some((m) => sameMark(m, outer))) break
      group.push({ text: r.text, marks: r.marks.filter((m) => !sameMark(m, outer)) })
      j++
    }
    out.push(...wrapMark(outer, buildInline(group)))
    i = j
  }
  return out
}

function wrapMark(mark: TTMark, children: MdNode[]): MdNode[] {
  switch (mark.type) {
    case 'code':
      return [{ type: 'inlineCode', value: collectText(children) }]
    case 'bold':
      return [{ type: 'strong', children }]
    case 'italic':
      return [{ type: 'emphasis', children }]
    case 'strike':
      return [{ type: 'delete', children }]
    case 'underline':
      return [{ type: 'html', value: '<u>' }, ...children, { type: 'html', value: '</u>' }]
    case 'highlight':
      return [{ type: 'html', value: '<mark>' }, ...children, { type: 'html', value: '</mark>' }]
    case 'link': {
      const md: MdNode = { type: 'link', url: (mark.attrs?.href as string) ?? '', children }
      if (mark.attrs?.title != null) md.title = mark.attrs.title as string
      return [md]
    }
    default:
      return children
  }
}

function collectText(nodes: MdNode[]): string {
  return nodes
    .map((n) => (n.value != null ? n.value : n.children ? collectText(n.children) : ''))
    .join('')
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function clampHeading(level: number): number {
  if (level < 1) return 1
  if (level > 6) return 6
  return level
}

function paragraphOrNode(type: string, attrs: Record<string, unknown>, content: TTNode[]): TTNode {
  return content.length > 0 ? { type, attrs, content } : { type, attrs }
}

function firstChildInline(node: MdNode): MdNode[] {
  const first = node.children?.[0]
  return first?.children ?? []
}

function textOf(nodes: TTNode[]): string {
  return nodes.map((n) => n.text ?? '').join('')
}

function mergeMarks(a: TTMark[], b: TTMark[]): TTMark[] {
  const out = [...a]
  for (const mark of b) if (!out.some((m) => sameMark(m, mark))) out.push(mark)
  return out
}

function addMark(marks: TTMark[], mark: TTMark): TTMark[] {
  if (marks.some((m) => sameMark(m, mark))) return marks
  return [...marks, mark]
}

function removeLastMark(marks: TTMark[], type: string): TTMark[] {
  for (let i = marks.length - 1; i >= 0; i--) {
    if (marks[i].type === type) {
      return [...marks.slice(0, i), ...marks.slice(i + 1)]
    }
  }
  return marks
}

function sameMark(a: TTMark, b: TTMark): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'link') {
    return (a.attrs?.href ?? '') === (b.attrs?.href ?? '')
  }
  return true
}

function marksEqual(a: TTMark[], b: TTMark[]): boolean {
  if (a.length !== b.length) return false
  return a.every((mark) => b.some((m) => sameMark(m, mark) && sameAttrs(m, mark)))
}

function sameAttrs(a: TTMark, b: TTMark): boolean {
  return JSON.stringify(a.attrs ?? null) === JSON.stringify(b.attrs ?? null)
}

function mergeAdjacentText(nodes: TTNode[]): TTNode[] {
  const out: TTNode[] = []
  for (const node of nodes) {
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.type === 'text' &&
      node.type === 'text' &&
      marksEqual(prev.marks ?? [], node.marks ?? [])
    ) {
      prev.text = (prev.text ?? '') + (node.text ?? '')
    } else {
      out.push(node)
    }
  }
  return out
}
