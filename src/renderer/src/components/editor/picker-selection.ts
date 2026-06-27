/**
 * Content trust boundary for the HTML element picker. The artifact shares the
 * iframe's JS realm with the injected picker bootstrap, so a picked-element
 * message is UNTRUSTED input even after the caller authenticates the window
 * identity (`event.source`). This helper validates the payload shape and
 * re-clamps the field lengths before the data ever reaches the chat — kept pure
 * (no DOM) so the boundary is unit-testable in the node test env.
 *
 * The 200 / 80 caps mirror SELECTOR_MAX / TEXT_MAX in
 * src/main/protocol/picker-bootstrap.ts (no cross-process import).
 */
export const PICK_SELECTOR_MAX = 200
export const PICK_TEXT_MAX = 80

/**
 * Cap for edit-mode oldText/newHTML. Mirrors EDIT_TEXT_MAX in
 * src/main/protocol/picker-bootstrap.ts (no cross-process import).
 */
export const PICK_EDIT_TEXT_MAX = 5000

/**
 * Max depth of the edit-target child-index path. Generous — real DOM nesting is
 * far shallower; this just bounds a forged payload.
 */
export const PICK_EDIT_PATH_MAX = 100

interface PickMessage {
  source?: unknown
  type?: unknown
  selector?: unknown
  text?: unknown
}

/**
 * Turn an untrusted picker message into the chat one-liner, or `null` if it is
 * not a well-formed `pick` (wrong/absent discriminators, non-object, or an empty
 * selector). On success the selector/text are clamped to the shared caps.
 */
export function formatPickedSelection(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const msg = data as PickMessage
  if (msg.source !== 'gt-element-picker' || msg.type !== 'pick') return null

  const selector = String(msg.selector ?? '').slice(0, PICK_SELECTOR_MAX)
  if (!selector) return null
  const text = String(msg.text ?? '').slice(0, PICK_TEXT_MAX)

  const label = text ? `${selector}  ("${text}")` : selector
  return `Selected element: ${label}`
}

export interface EditCommit {
  /**
   * Child-index path from <html> (documentElement) to the edited element — the
   * locator the main process re-walks against the on-disk source. We use an exact
   * index path, not a CSS selector, because heuristic selectors don't reliably
   * round-trip to a fresh parse (see src/main/protocol/html-text-patch.ts).
   */
  path: number[]
  /** Plain-text locator (the block's text before the edit). */
  oldText: string
  /** The block's new innerHTML — inline formatting preserved. */
  newHTML: string
}

interface EditCommitMessage {
  source?: unknown
  type?: unknown
  path?: unknown
  oldText?: unknown
  newHTML?: unknown
}

/**
 * Validate an untrusted `edit-commit` message into an EditCommit, or `null` if it
 * is not a well-formed commit. Like formatPickedSelection, the fields are
 * validated/coerced so the boundary never trusts the payload's shape: `path` must
 * be a non-empty, bounded array of non-negative integers; oldText/newHTML are
 * String()-coerced and re-clamped. No-op edits (empty newHTML, or newHTML
 * unchanged from oldText — the unformatted case) are dropped here so the main
 * process never patches without a change. Kept pure (no DOM) so it is unit-testable
 * in the node test env.
 */
export function parseEditCommit(data: unknown): EditCommit | null {
  if (!data || typeof data !== 'object') return null
  const msg = data as EditCommitMessage
  if (msg.source !== 'gt-element-picker' || msg.type !== 'edit-commit') return null

  if (!Array.isArray(msg.path) || msg.path.length === 0 || msg.path.length > PICK_EDIT_PATH_MAX) {
    return null
  }
  const path: number[] = []
  for (const raw of msg.path) {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return null
    path.push(raw)
  }

  const oldText = String(msg.oldText ?? '').slice(0, PICK_EDIT_TEXT_MAX)
  const newHTML = String(msg.newHTML ?? '').slice(0, PICK_EDIT_TEXT_MAX)
  if (!newHTML || newHTML === oldText) return null

  return { path, oldText, newHTML }
}

/**
 * True when `data` is the iframe's `mode-exit` notification — posted whenever the
 * picker leaves inspect/edit on its own (a no-op edit, an Escape, or its own
 * commit teardown). The parent uses it to clear its toggle state so the React
 * mirror can't desync from the frame. Carries no payload beyond the discriminators
 * (it only flips local UI booleans off), so a plain shape check suffices.
 */
export function isModeExitMessage(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const msg = data as { source?: unknown; type?: unknown }
  return msg.source === 'gt-element-picker' && msg.type === 'mode-exit'
}
