import { useRef, useEffect, useState, useCallback } from 'react'
import { type Editor, useEditorState } from '@tiptap/react'
import {
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ALargeSmall,
  Replace,
  ReplaceAll,
  ChevronRight
} from 'lucide-react'
import type { SearchStorage } from './extensions/search-and-replace'

interface SearchBarProps {
  editor: Editor | null
}

export function SearchBar({ editor }: SearchBarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [showReplace, setShowReplace] = useState(false)

  const state = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) return null
      const storage = (ctx.editor.storage as unknown as Record<string, SearchStorage>)
        .searchAndReplace
      return {
        isOpen: storage.isOpen,
        searchTerm: storage.searchTerm,
        replaceTerm: storage.replaceTerm,
        caseSensitive: storage.caseSensitive,
        resultCount: storage.results.length,
        currentIndex: storage.currentIndex
      }
    }
  })

  const focusSearch = useCallback(() => {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [])

  // Focus search input when opened
  useEffect(() => {
    if (state?.isOpen) {
      focusSearch()
    }
  }, [state?.isOpen, focusSearch])

  if (!editor || !state || !state.isOpen) return null

  const matchDisplay =
    state.resultCount > 0
      ? `${state.currentIndex + 1} of ${state.resultCount}`
      : state.searchTerm
        ? 'No results'
        : ''

  return (
    <div className="border-b border-border bg-background px-3 py-1.5 flex flex-col gap-1">
      {/* Search row */}
      <div className="flex items-center gap-1.5">
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setShowReplace(!showReplace)}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
          title={showReplace ? 'Hide replace' : 'Show replace'}
        >
          <ChevronRight
            className={`h-4 w-4 transition-transform ${showReplace ? 'rotate-90' : ''}`}
          />
        </button>

        <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />

        <input
          ref={searchInputRef}
          type="text"
          value={state.searchTerm}
          onChange={(e) => editor.commands.setSearchTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              editor.commands.nextSearchResult()
            }
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault()
              editor.commands.prevSearchResult()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              editor.commands.closeSearch()
            }
          }}
          placeholder="Search..."
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
        />

        {/* Match count */}
        <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
          {matchDisplay}
        </span>

        {/* Case sensitivity toggle */}
        <button
          type="button"
          onClick={() => editor.commands.setCaseSensitive(!state.caseSensitive)}
          title="Match case"
          className={`p-1 rounded transition-colors ${
            state.caseSensitive
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ALargeSmall className="h-4 w-4" />
        </button>

        {/* Navigation */}
        <button
          type="button"
          onClick={() => editor.commands.prevSearchResult()}
          title="Previous match (Shift+Enter)"
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          disabled={state.resultCount === 0}
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => editor.commands.nextSearchResult()}
          title="Next match (Enter)"
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          disabled={state.resultCount === 0}
        >
          <ChevronDown className="h-4 w-4" />
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={() => editor.commands.closeSearch()}
          title="Close (Escape)"
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="flex items-center gap-1.5 pl-[26px]">
          <Replace className="h-4 w-4 text-muted-foreground flex-shrink-0" />

          <input
            type="text"
            value={state.replaceTerm}
            onChange={(e) => editor.commands.setReplaceTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                editor.commands.replaceCurrentResult()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                editor.commands.closeSearch()
              }
            }}
            placeholder="Replace..."
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
          />

          <button
            type="button"
            onClick={() => editor.commands.replaceCurrentResult()}
            title="Replace"
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            disabled={state.resultCount === 0}
          >
            <Replace className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => editor.commands.replaceAllResults()}
            title="Replace all"
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            disabled={state.resultCount === 0}
          >
            <ReplaceAll className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
