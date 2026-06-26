import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Popover, PopoverAnchor, PopoverContent } from '@renderer/components/ui/popover'
import { normalizeStringArray, stripTagHash } from './properties-model'

interface TagChipInputProps {
  values: string[]
  /** Called with the next normalized array whenever the chip set changes. */
  onChange: (next: string[]) => void
  /** When set, clicking a chip's label calls this with the chip value (filter). */
  onChipClick?: (value: string) => void
  /** Fetch autocomplete suggestions for the current input (workspace-global). */
  suggest?: (prefix: string) => Promise<string[]>
  placeholder?: string
  disabled?: boolean
  /** Tags strip a leading `#`; plain lists keep the raw token. */
  stripHash?: boolean
}

/**
 * Standalone chip-input combobox built directly on the Radix Popover primitive
 * plus a plain text input (NOT the ProseMirror slash-command Suggestion plugin —
 * that can't drive a React sibling, M6). Used for both the `tags` and `list`
 * widgets in the Properties editor.
 */
export function TagChipInput({
  values,
  onChange,
  onChipClick,
  suggest,
  placeholder = 'Add…',
  disabled = false,
  stripHash = true
}: TagChipInputProps) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounced suggestion fetch. Filters out already-selected tags.
  useEffect(() => {
    if (!suggest || disabled) return
    let cancelled = false
    const handle = setTimeout(async () => {
      const raw = await suggest(input.trim())
      if (cancelled) return
      const selected = new Set(values.map((v) => v.toLowerCase()))
      const filtered = raw.filter((s) => !selected.has(s.toLowerCase())).slice(0, 8)
      setSuggestions(filtered)
      setActiveIndex(0)
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [input, suggest, disabled, values])

  function commit(raw: string): void {
    const token = stripHash ? stripTagHash(raw.trim()) : raw.trim()
    if (token.length === 0) return
    onChange(normalizeStringArray([...values, token]))
    setInput('')
    setOpen(false)
  }

  function removeAt(index: number): void {
    onChange(values.filter((_, i) => i !== index))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (open && suggestions[activeIndex]) commit(suggestions[activeIndex])
      else commit(input)
    } else if (e.key === 'Backspace' && input.length === 0 && values.length > 0) {
      removeAt(values.length - 1)
    } else if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <Popover open={open && suggestions.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            'flex flex-wrap items-center gap-1.5 rounded-md border border-transparent bg-transparent px-1 -mx-1 py-0.5 min-h-7',
            'hover:border-input focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
            disabled && 'pointer-events-none opacity-50'
          )}
          onClick={() => inputRef.current?.focus()}
        >
          {values.map((value, index) => (
            <span
              key={`${value}-${index}`}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs text-accent-foreground"
            >
              {onChipClick ? (
                <button
                  type="button"
                  title={`Filter notes by ${value}`}
                  className="hover:underline"
                  onClick={(e) => {
                    e.stopPropagation()
                    onChipClick(value)
                  }}
                >
                  {value}
                </button>
              ) : (
                value
              )}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                className="opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  removeAt(index)
                }}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={input}
            disabled={disabled}
            placeholder={values.length === 0 ? placeholder : ''}
            className="flex-1 min-w-[60px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(e) => {
              setInput(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div role="listbox" className="max-h-48 overflow-y-auto">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm',
                index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                commit(suggestion)
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
