/**
 * Pure HTML text patcher for the inline edit-and-save flow in the artifact viewer.
 *
 * The sandboxed iframe sends an `edit-commit` carrying { oldText, newHTML, path }.
 * We locate the source element to patch by its CONTENT, not its position: find the
 * block-level element whose normalized text equals `oldText`. Matching on text
 * makes this immune to the thing that breaks selector/index mapping — the browser
 * restructures the live DOM (auto-inserted <tbody>, fixed-up invalid nesting,
 * reordering) so a position computed in the iframe doesn't re-resolve against a
 * fresh parse of the file. Text doesn't move.
 *
 * The edit unit is the nearest BLOCK-LEVEL element (e.g. <p>, <h1>, <li>), not a
 * bare leaf — so a paragraph that mixes direct text with inline children
 * (`<p>Hello <b>world</b></p>`) is editable as a whole. We therefore apply the
 * edit with `innerHTML`, which preserves the inline formatting the user kept while
 * editing in the contenteditable frame. Inline wrappers (<b>, <span>, <a>, …) are
 * NOT edit targets themselves — they live inside their block and round-trip
 * through innerHTML.
 *
 * `path` (the child-index path from <html>) is kept only as a TIEBREAKER for the
 * rare case where several blocks share identical text.
 *
 * FAIL-SAFE: if no block matches `oldText`, the rendered text never existed in the
 * file as static markup — it's script-generated, or a stale unsaved edit poisoned
 * oldText — so we refuse rather than guess. (The renderer reloads the frame on
 * failure, which clears any stale edit.) Duplicate text with no unique path match
 * also refuses.
 *
 * TRADEOFF: we reserialize the whole document via linkedom (`document.toString()`),
 * which reflows/normalizes markup rather than doing a surgical byte-range splice.
 * Acceptable for v1 (artifacts are generated files); the text match + block-only
 * targeting is what keeps the edit on the intended node. Pure (no fs) so it is
 * directly unit-testable.
 */

import { parseHTML } from 'linkedom'

export interface HtmlTextPatch {
  /**
   * Child-index path from <html> (documentElement) to the edited element. Used
   * only to disambiguate duplicate identical text — the primary locator is the
   * text itself.
   */
  path: number[]
  oldText: string
  /**
   * The edited element's new innerHTML (inline formatting preserved). Applied
   * verbatim to the located block element.
   */
  newHTML: string
}

// Mirrored across processes (frame + main) — keep IDENTICAL. NO cross-process
// import, matching the SELECTOR_MAX/TEXT_MAX duplication pattern.
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// Leaf tags whose text is not user-visible content — never an edit target even if
// their text happens to equal oldText.
const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'title'])

// Inline-formatting tags. An element made only of text + these is a single
// editable text block; these tags are never edit targets on their own (they
// round-trip inside their block's innerHTML). Mirrored IDENTICALLY in
// src/main/protocol/picker-bootstrap.ts (INLINE_TAGS) — no cross-process import.
const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'dfn',
  'em',
  'i',
  'kbd',
  'mark',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
  'label',
  'output',
  'font',
  'ins',
  'del',
  'big',
  'tt',
  'nobr'
])

// A block-level text target: a non-inline, non-skipped element whose subtree
// holds only text + inline formatting (no nested block element). This mirrors the
// picker's editTargetFor, so the element the frame made editable is the element we
// find here.
function isBlockTextTarget(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (SKIP_TAGS.has(tag) || INLINE_TAGS.has(tag)) return false
  const descendants = el.querySelectorAll('*')
  for (let i = 0; i < descendants.length; i++) {
    const t = descendants[i].tagName
    if (t && !INLINE_TAGS.has(t.toLowerCase())) return false // a nested block — too coarse
  }
  return true
}

// Child-index path from documentElement down to `el` (mirrors the frame's
// computePath), so we can compare against the path the frame sent.
function pathOf(el: Element): number[] {
  const indices: number[] = []
  let cur: Element | null = el
  while (cur && cur.parentElement) {
    const siblings = cur.parentElement.children
    let idx = -1
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i] === cur) {
        idx = i
        break
      }
    }
    if (idx < 0) break
    indices.unshift(idx)
    cur = cur.parentElement
  }
  return indices
}

function samePath(a: number[], b: number[]): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function patchHtmlText(html: string, patch: HtmlTextPatch): string {
  const { document } = parseHTML(html)

  const expected = normalize(patch.oldText)
  if (!expected) throw new Error("Couldn't locate the edited element in the saved file.")

  // Primary locator: block-level text elements (no nested block) whose visible
  // text equals oldText. Inline wrappers and non-visible containers are excluded.
  const matches = Array.from(document.querySelectorAll('*')).filter(
    (el) => isBlockTextTarget(el) && normalize(el.textContent || '') === expected
  )

  let target: Element
  if (matches.length === 1) {
    target = matches[0]
  } else if (matches.length === 0) {
    throw new Error("This text no longer matches the saved file, so it wasn't saved.")
  } else {
    // Duplicate identical text — disambiguate by the index path the frame sent.
    const byPath = matches.filter((el) => samePath(pathOf(el), patch.path))
    if (byPath.length !== 1) {
      throw new Error("This text appears more than once and couldn't be matched to one place.")
    }
    target = byPath[0]
  }

  target.innerHTML = patch.newHTML

  // Full-document reserialize (see module doc: reflow tradeoff, safe for v1).
  return document.toString()
}
