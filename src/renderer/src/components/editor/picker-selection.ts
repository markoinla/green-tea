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
