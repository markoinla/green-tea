import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Document } from '../../../../main/database/types'

interface DocumentTitleProps {
  document: Document
}

/**
 * Obsidian-style inline title heading rendered above the Properties block and
 * note content. Editing it renames the document via `db:documents:update`,
 * which also renames the backing .md file (title is the source of truth, never
 * stored in frontmatter). The textarea auto-grows so long titles wrap cleanly.
 */
export function DocumentTitle({ document: doc }: DocumentTitleProps) {
  const [value, setValue] = useState(doc.title)
  const ref = useRef<HTMLTextAreaElement>(null)

  // Re-sync when the document changes externally (sidebar rename, doc switch).
  useEffect(() => {
    setValue(doc.title)
  }, [doc.id, doc.title])

  // Grow the textarea to fit its content (single line by default, wraps long titles).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const commit = (): void => {
    const next = value.trim()
    if (!next || next === doc.title) {
      setValue(doc.title)
      return
    }
    window.api.documents.update(doc.id, { title: next })
  }

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      spellCheck={false}
      placeholder="Untitled"
      aria-label="Document title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setValue(doc.title)
          e.currentTarget.blur()
        }
      }}
      className="w-full resize-none overflow-hidden border-none bg-transparent p-0 font-extrabold tracking-tight text-foreground opacity-60 outline-none placeholder:text-muted-foreground/40"
      style={{
        fontSize: '2.1rem',
        lineHeight: 1.15,
        fontFamily: 'var(--editor-heading-font, Inter, sans-serif)'
      }}
    />
  )
}
