import { useEffect, type RefObject } from 'react'

/**
 * Dismiss a non-modal drawer/popover when the user presses anywhere outside it.
 *
 * Listens on the document in the CAPTURE phase so it fires even when inner regions
 * (the TipTap editor, the sidebars) call stopPropagation / preventDefault on the
 * pointer event first — which is exactly why Radix's own outside-detection only
 * caught clicks on some regions (e.g. the chat panel) and missed the rest.
 *
 * Clicks inside ANY open Sheet (`[data-slot="sheet-content"]`) and on the optional
 * trigger element are treated as "inside" and never dismiss.
 */
export function useOutsideDismiss(
  open: boolean,
  onDismiss: () => void,
  triggerRef?: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-slot="sheet-content"]')) return
      if (triggerRef?.current?.contains(target)) return
      onDismiss()
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [open, onDismiss, triggerRef])
}
