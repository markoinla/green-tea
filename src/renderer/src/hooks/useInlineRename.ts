import { useState, useRef, useEffect, useCallback } from 'react'

interface UseInlineRenameOptions {
  currentName: string
  onRename: (newName: string) => void
}

export function useInlineRename({ currentName, onRename }: UseInlineRenameOptions) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(currentName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const startEditing = useCallback(() => {
    setEditValue(currentName)
    setIsEditing(true)
  }, [currentName])

  const handleSubmit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== currentName) {
      onRename(trimmed)
    }
    setIsEditing(false)
  }, [editValue, currentName, onRename])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSubmit()
      } else if (e.key === 'Escape') {
        setIsEditing(false)
        setEditValue(currentName)
      }
    },
    [handleSubmit, currentName]
  )

  return {
    isEditing,
    editValue,
    inputRef,
    startEditing,
    setEditValue,
    handleSubmit,
    handleKeyDown
  }
}
