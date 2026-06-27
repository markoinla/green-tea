/**
 * HTML element picker bootstrap — the code that runs INSIDE the sandboxed,
 * opaque-origin artifact iframe to power "inspect element → inject as chat
 * context".
 *
 * Why this file ships runtime logic as a STRING (`.toString()` injection):
 * the artifact frame is `sandbox="allow-scripts"` with a null origin, so the
 * parent renderer can never reach into its DOM to attach listeners. The only
 * way to get trusted code into that frame is to inject a `<script>` at serve
 * time (see gt-file.ts). So the runtime is authored as real, type-checked
 * functions here and stringified into `PICKER_BOOTSTRAP_SCRIPT`.
 *
 * Minification-safety: because the functions are stringified and executed in
 * the iframe (a different JS realm), they MUST be fully self-contained — they
 * may reference ONLY browser globals + their own parameters, never any
 * module-scope binding (those names get renamed/removed by the production
 * minifier and would not exist in the iframe anyway). Everything they need is
 * passed in: `pickerRuntime` receives `buildSelector` and a plain `cfg` object,
 * and `buildSelector` hardcodes its own depth cap. The runtime decouples names
 * by taking `buildSelector` as a PARAMETER so minified call sites still line up.
 */

export const PICKER_BOOTSTRAP_MARKER = '__GT_ELEMENT_PICKER__'

export const SELECTOR_MAX = 200
export const TEXT_MAX = 80
export const TAG_MAX = 40
export const EDIT_TEXT_MAX = 5000

/**
 * Build a CSS selector for `el` by walking up to 5 ancestors. Dependency-free
 * so it runs identically in a real browser iframe and in a linkedom unit test:
 * it touches only `ownerDocument`, `parentElement`, `children`, `id`,
 * `classList`, and `tagName` — never a global `document` and never `CSS.escape`.
 *
 * This function is stringified into the iframe; it must NOT reference any
 * module-scope constant. The depth cap (5) is hardcoded inline.
 */
export function buildSelector(el: Element): string {
  if (!el || !el.tagName) return ''

  const segments: string[] = []
  let node: Element | null = el
  let depth = 0

  while (node && node.tagName && depth < 5) {
    const tag = node.tagName.toLowerCase()
    if (tag === 'body' || tag === 'html') break

    // Prefer a unique id — short and stable. querySelectorAll can throw on an
    // id that is not a valid selector; treat any throw as "not unique".
    if (node.id) {
      let unique = false
      try {
        unique = node.ownerDocument.querySelectorAll('#' + node.id).length === 1
      } catch {
        unique = false
      }
      if (unique) {
        segments.unshift('#' + node.id)
        break
      }
    }

    let segment = tag

    if (node.classList && node.classList.length) {
      // Array.from works in both a real browser DOMTokenList and linkedom;
      // indexed access (classList[i]) does NOT in linkedom.
      const classes = Array.from(node.classList).slice(0, 2)
      segment += '.' + classes.join('.')
    }

    // Disambiguate against same-tag siblings with :nth-of-type(n).
    const parent = node.parentElement
    if (parent) {
      let sameTag = 0
      let index = 0
      const children = parent.children
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child.tagName && child.tagName.toLowerCase() === tag) {
          sameTag++
          if (child === node) index = sameTag
        }
      }
      if (sameTag > 1) {
        segment += ':nth-of-type(' + index + ')'
      }
    }

    segments.unshift(segment)
    node = node.parentElement
    depth++
  }

  return segments.join(' > ')
}

/**
 * The picker runtime. Self-contained: references only browser globals and its
 * two parameters (`buildSelector`, `cfg`). It is dormant on load — it installs
 * a single `message` listener and does nothing until the parent posts
 * `{ source, type: 'set-inspect', on }` or `{ source, type: 'set-edit', on }`.
 *
 * A single `mode` state ('none' | 'inspect' | 'edit') drives everything. The
 * hover overlay + global mousemove/keydown listeners are shared by both active
 * modes; only the click handler branches on the current mode.
 */
function pickerRuntime(
  buildSelector: (el: Element) => string,
  cfg: {
    source: string
    SELECTOR_MAX: number
    TEXT_MAX: number
    TAG_MAX: number
    EDIT_TEXT_MAX: number
  }
): void {
  let mode: 'none' | 'inspect' | 'edit' = 'none'
  let overlay: HTMLDivElement | null = null
  // Per-edit teardown for the element currently in contenteditable, if any.
  let editCleanup: (() => void) | null = null

  function normalize(s: string): string {
    return s.replace(/\s+/g, ' ').trim()
  }

  // Inline-formatting tags. An element made only of text + these is a single
  // editable text block. Mirrored IDENTICALLY in
  // src/main/protocol/html-text-patch.ts (INLINE_TAGS). Self-contained literal so
  // it survives stringified injection into the iframe realm.
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

  function isInline(node: Element | null): boolean {
    return !!node && !!node.tagName && INLINE_TAGS.has(node.tagName.toLowerCase())
  }

  function hasBlockDescendant(node: Element): boolean {
    const all = node.querySelectorAll('*')
    for (let i = 0; i < all.length; i++) {
      const t = all[i].tagName
      if (t && !INLINE_TAGS.has(t.toLowerCase())) return true
    }
    return false
  }

  // Resolve the editable unit for a clicked element: climb out of inline wrappers
  // (<b>/<span>/<a>/…) to the nearest block-level ancestor, so clicking bold text
  // inside a <p> edits the WHOLE paragraph rather than just the <b>. Returns null
  // when there is no usable block (e.g. the click landed on <body>) or the block
  // contains nested block elements (its text spans multiple paragraphs — editing
  // its innerHTML would be destructive) or it has no visible text.
  function editTargetFor(start: Element | null): Element | null {
    if (!start || !start.tagName) return null
    let block: Element | null = start
    while (block && isInline(block) && block.parentElement) block = block.parentElement
    if (!block || !block.tagName) return null
    const tag = block.tagName.toLowerCase()
    if (tag === 'body' || tag === 'html') return null
    if (hasBlockDescendant(block)) return null
    if (!normalize(block.textContent || '')) return null
    return block
  }

  // Build the child-index path from <html> (documentElement) down to `node`:
  // [1, 0, 3] means documentElement.children[1].children[0].children[3]. This is
  // the EDIT locator (the main process re-walks it against the source). Unlike a
  // CSS selector it round-trips reliably, because the only nodes the picker injects
  // (the bootstrap <script> + hover overlay) are TRAILING children of <body> and so
  // never shift the indices of the content before them. Returns null if `node` is
  // detached from documentElement. Uses only `parentElement` + `children` so it is
  // self-contained for stringified injection.
  function computePath(node: Element): number[] | null {
    const indices: number[] = []
    let cur: Element | null = node
    while (cur && cur.parentElement) {
      const siblings = cur.parentElement.children
      let idx = -1
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i] === cur) {
          idx = i
          break
        }
      }
      if (idx < 0) return null
      indices.unshift(idx)
      cur = cur.parentElement
    }
    return indices
  }

  function positionOverlay(target: Element): void {
    if (!overlay) return
    const rect = target.getBoundingClientRect()
    overlay.style.top = rect.top + 'px'
    overlay.style.left = rect.left + 'px'
    overlay.style.width = rect.width + 'px'
    overlay.style.height = rect.height + 'px'
  }

  function onMouseMove(e: MouseEvent): void {
    const target = e.target as Element | null
    if (target && typeof target.getBoundingClientRect === 'function') positionOverlay(target)
  }

  function onInspectClick(e: MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    const el = e.target as Element
    const selector = buildSelector(el).slice(0, cfg.SELECTOR_MAX)
    const tag = (el.tagName || '').toLowerCase().slice(0, cfg.TAG_MAX)
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, cfg.TEXT_MAX)
    window.parent.postMessage({ source: cfg.source, type: 'pick', selector, tag, text }, '*')
    setMode('none')
  }

  function onEditClick(e: MouseEvent): void {
    // Already mid-edit: a click on the active element should just reposition the
    // cursor (we return WITHOUT preventDefault), and a click elsewhere is handled
    // by its blur→commit. Re-entering here would stack a second keydown/blur pair
    // and post the edit TWICE (the second post fails the oldText guard after the
    // first has already written the file).
    if (editCleanup) return
    // Resolve the editable block from the click target, climbing out of inline
    // formatting so a <p> with bold/italic/span children is editable as a whole.
    const target = editTargetFor(e.target as Element)
    if (!target) return
    const el: Element = target

    // Capture the locator BEFORE we mutate the element (contenteditable/focus), so
    // nothing we add can shift it. Bail if the element can't be located.
    const path = computePath(el)
    if (!path) return

    e.preventDefault()
    e.stopPropagation()

    // We edit and commit innerHTML, not textContent, so inline formatting the user
    // keeps (or adds) inside the contenteditable block round-trips into the file.
    const originalHTML = el.innerHTML
    const originalText = el.textContent || ''
    let committed = false

    el.setAttribute('contenteditable', 'true')
    ;(el as HTMLElement).focus()

    function cleanup(): void {
      el.removeAttribute('contenteditable')
      window.removeEventListener('keydown', onShieldKeyDown as EventListener, true)
      window.removeEventListener('keyup', onShieldKey as EventListener, true)
      window.removeEventListener('keypress', onShieldKey as EventListener, true)
      el.removeEventListener('blur', onBlur, true)
      editCleanup = null
    }

    function commit(): void {
      // Guard against the commit-then-blur double fire.
      if (committed) return
      committed = true
      const newHTML = el.innerHTML
      const oldText = normalize(originalText)
      cleanup()
      // Post only a real change with visible text. oldText is the plain-text
      // locator; newHTML carries the formatting. Skip whitespace-only results.
      if (newHTML !== originalHTML && normalize(el.textContent || '')) {
        window.parent.postMessage(
          {
            source: cfg.source,
            type: 'edit-commit',
            path,
            oldText,
            newHTML: newHTML.slice(0, cfg.EDIT_TEXT_MAX)
          },
          '*'
        )
      }
      setMode('none')
    }

    function cancel(): void {
      if (committed) return
      committed = true
      el.innerHTML = originalHTML
      cleanup()
      setMode('none')
    }

    // While editing, intercept key events at WINDOW capture — ahead of the
    // artifact's own document/window handlers — so pages that hijack Space /
    // Arrows / Enter (slide decks, games, scroll-jackers) can't steal keystrokes
    // from the field. stopImmediatePropagation blocks the page's listeners but
    // does NOT cancel the default action, so the character is still typed; only
    // Enter (commit) and Escape (cancel) are consumed by us.
    function onShieldKeyDown(ev: KeyboardEvent): void {
      ev.stopImmediatePropagation()
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault()
        commit()
      } else if (ev.key === 'Escape') {
        ev.preventDefault()
        cancel()
      }
    }

    // Some pages bind shortcuts on keyup/keypress too — shield those as well (no
    // preventDefault, so typing is unaffected).
    function onShieldKey(ev: KeyboardEvent): void {
      ev.stopImmediatePropagation()
    }

    function onBlur(): void {
      commit()
    }

    window.addEventListener('keydown', onShieldKeyDown as EventListener, true)
    window.addEventListener('keyup', onShieldKey as EventListener, true)
    window.addEventListener('keypress', onShieldKey as EventListener, true)
    el.addEventListener('blur', onBlur, true)
    editCleanup = cleanup
  }

  function onClick(e: MouseEvent): void {
    if (mode === 'inspect') onInspectClick(e)
    else if (mode === 'edit') onEditClick(e)
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Escape exits the current mode. During an ACTIVE edit this never runs — the
    // window-capture shield handles Escape (restoring the original text) and stops
    // propagation first. So this only fires for inspect mode or edit-mode hover.
    if (e.key === 'Escape') setMode('none')
  }

  function setMode(next: 'none' | 'inspect' | 'edit'): void {
    if (next === mode) return
    const prev = mode
    mode = next

    // Tear down the previous mode fully.
    if (prev !== 'none') {
      document.removeEventListener('mousemove', onMouseMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
      overlay = null
      // If we were mid-edit, drop the contenteditable + element listeners.
      if (editCleanup) editCleanup()
    }

    // Bring up the new mode (shared overlay for both inspect and edit).
    if (next !== 'none') {
      overlay = document.createElement('div')
      overlay.style.position = 'fixed'
      overlay.style.pointerEvents = 'none'
      overlay.style.zIndex = '2147483647'
      overlay.style.outline = '2px solid #2563eb'
      overlay.style.background = 'rgba(37, 99, 235, 0.15)'
      overlay.style.top = '0px'
      overlay.style.left = '0px'
      overlay.style.width = '0px'
      overlay.style.height = '0px'
      document.body.appendChild(overlay)
      document.addEventListener('mousemove', onMouseMove, true)
      document.addEventListener('click', onClick, true)
      document.addEventListener('keydown', onKeyDown, true)
    }

    // Tell the parent whenever a mode ENDS, so its React mirror of the toggle
    // state can't desync. Without this, a self-initiated exit the parent didn't
    // ask for — a no-op edit (click an element, click away without changing it),
    // an Escape, or our own commit teardown — leaves the parent thinking the mode
    // is still on, so the next toggle click appears to do nothing. Idempotent:
    // when the parent itself requested the exit it has already cleared its state.
    if (prev !== 'none' && next === 'none') {
      window.parent.postMessage({ source: cfg.source, type: 'mode-exit' }, '*')
    }
  }

  window.addEventListener('message', (e: MessageEvent) => {
    if (!e.data || e.data.source !== cfg.source) return
    if (e.data.type === 'set-inspect') {
      if (e.data.on) setMode('inspect')
      else if (mode === 'inspect') setMode('none')
    } else if (e.data.type === 'set-edit') {
      if (e.data.on) setMode('edit')
      else if (mode === 'edit') setMode('none')
    }
  })
}

/**
 * The full `<script>…</script>` string injected into the entry document. The
 * leading `;` before the IIFE guards against ASI hazards from whatever the
 * artifact's own trailing markup looks like (this codebase omits semicolons).
 */
export const PICKER_BOOTSTRAP_SCRIPT = `<script>/*${PICKER_BOOTSTRAP_MARKER}*/\n;(${pickerRuntime.toString()})(${buildSelector.toString()}, ${JSON.stringify(
  { source: 'gt-element-picker', SELECTOR_MAX, TEXT_MAX, TAG_MAX, EDIT_TEXT_MAX }
)});\n</script>`
