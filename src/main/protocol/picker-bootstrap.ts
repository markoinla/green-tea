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
 * `{ source, type: 'set-inspect', on }`.
 */
function pickerRuntime(
  buildSelector: (el: Element) => string,
  cfg: { source: string; SELECTOR_MAX: number; TEXT_MAX: number; TAG_MAX: number }
): void {
  let inspectOn = false
  let overlay: HTMLDivElement | null = null

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

  function onClick(e: MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    const el = e.target as Element
    const selector = buildSelector(el).slice(0, cfg.SELECTOR_MAX)
    const tag = (el.tagName || '').toLowerCase().slice(0, cfg.TAG_MAX)
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, cfg.TEXT_MAX)
    window.parent.postMessage({ source: cfg.source, type: 'pick', selector, tag, text }, '*')
    setInspect(false)
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') setInspect(false)
  }

  function setInspect(on: boolean): void {
    if (on === inspectOn) return
    inspectOn = on
    if (on) {
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
    } else {
      document.removeEventListener('mousemove', onMouseMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
      overlay = null
    }
  }

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.data && e.data.source === cfg.source && e.data.type === 'set-inspect') {
      setInspect(!!e.data.on)
    }
  })
}

/**
 * The full `<script>…</script>` string injected into the entry document. The
 * leading `;` before the IIFE guards against ASI hazards from whatever the
 * artifact's own trailing markup looks like (this codebase omits semicolons).
 */
export const PICKER_BOOTSTRAP_SCRIPT = `<script>/*${PICKER_BOOTSTRAP_MARKER}*/\n;(${pickerRuntime.toString()})(${buildSelector.toString()}, ${JSON.stringify(
  { source: 'gt-element-picker', SELECTOR_MAX, TEXT_MAX, TAG_MAX }
)});\n</script>`
