const VIEWPORT_MARGIN = 8

/**
 * Position a fixed popup relative to a trigger rect (e.g. a caret), keeping it
 * within the viewport. Prefers placing the popup above the trigger; flips below
 * when there isn't room. Clamps the left/top edges so the popup never overflows
 * the right or bottom of the screen.
 *
 * Reads `offsetWidth`/`offsetHeight`, so call it after the popup's content has
 * been laid out (defer with `requestAnimationFrame` on first render, since the
 * React component may not have painted yet).
 */
export function positionPopup(popup: HTMLElement, rect: DOMRect): void {
  const width = popup.offsetWidth
  const height = popup.offsetHeight

  const spaceAbove = rect.top
  const spaceBelow = window.innerHeight - rect.bottom

  // Prefer above; flip below if it doesn't fit above but does below.
  let top: number
  if (spaceAbove >= height + VIEWPORT_MARGIN || spaceAbove >= spaceBelow) {
    top = rect.top - height
  } else {
    top = rect.bottom
  }

  let left = rect.left

  // Clamp horizontally within the viewport.
  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN
  left = Math.min(left, maxLeft)
  left = Math.max(left, VIEWPORT_MARGIN)

  // Clamp vertically within the viewport.
  const maxTop = window.innerHeight - height - VIEWPORT_MARGIN
  top = Math.min(top, maxTop)
  top = Math.max(top, VIEWPORT_MARGIN)

  popup.style.left = `${left}px`
  popup.style.top = `${top}px`
}
