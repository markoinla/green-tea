import { useState, useRef, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

interface UseInlineRenameOptions {
  currentName: string
  /** May be async; a rejected promise keeps the row in edit mode and surfaces a toast. */
  onRename: (newName: string) => void | Promise<void>
}

export function useInlineRename({ currentName, onRename }: UseInlineRenameOptions) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(currentName)
  const inputRef = useRef<HTMLInputElement>(null)
  // The element that should regain focus when editing ends (the row button the
  // input lives inside). Captured on edit start so keyboard nav survives a rename.
  const triggerRef = useRef<HTMLElement | null>(null)
  // Guards against the Enter-then-blur double-commit (handleSubmit firing twice).
  const submittingRef = useRef(false)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      triggerRef.current = inputRef.current.closest('button')
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const restoreFocus = useCallback(() => {
    // Defer until after the input unmounts so focus lands on the row button.
    // Guard against the node having been detached in the meantime.
    requestAnimationFrame(() => {
      const el = triggerRef.current
      if (el && el.isConnected) el.focus()
    })
  }, [])

  const cancelEditing = useCallback(() => {
    setIsEditing(false)
    setEditValue(currentName)
    restoreFocus()
  }, [currentName, restoreFocus])

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return
    const trimmed = editValue.trim()
    // Empty or unchanged is a no-op cancel, not a write.
    if (!trimmed || trimmed === currentName) {
      cancelEditing()
      return
    }
    submittingRef.current = true
    try {
      await onRename(trimmed)
      // Leave submittingRef set on success: dropping out of edit mode unmounts
      // the input, which fires a trailing onBlur that would otherwise re-submit
      // the same value (currentName hasn't refreshed yet). It's reset the next
      // time editing starts.
      setIsEditing(false)
      restoreFocus()
    } catch {
      // Keep the row in edit mode so the user's text isn't lost, and allow retry.
      toast.error('Failed to rename')
      submittingRef.current = false
      inputRef.current?.focus()
    }
  }, [editValue, currentName, onRename, cancelEditing, restoreFocus])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEditing()
      }
    },
    [handleSubmit, cancelEditing]
  )

  return {
    isEditing,
    editValue,
    inputRef,
    startEditing: useCallback(() => {
      submittingRef.current = false
      setEditValue(currentName)
      setIsEditing(true)
    }, [currentName]),
    setEditValue,
    handleSubmit,
    handleKeyDown
  }
}
