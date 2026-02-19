import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { FileText, Paperclip } from 'lucide-react'

interface MentionItem {
  id: string
  label: string
}

interface MentionListProps {
  items: MentionItem[]
  command: (item: MentionItem) => void
}

export const MentionList = forwardRef<
  { onKeyDown: (props: { event: KeyboardEvent }) => boolean },
  MentionListProps
>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    setSelectedIndex(0)
  }, [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((prev) => (prev + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        const item = items[selectedIndex]
        if (item) {
          command(item)
        }
        return true
      }
      return false
    }
  }))

  if (items.length === 0) {
    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-2 text-xs text-muted-foreground">
        No documents found
      </div>
    )
  }

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[200px] max-h-[200px] overflow-y-auto">
      {items.map((item, index) => (
        <button
          key={item.id}
          onClick={() => command(item)}
          className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm transition-colors ${
            index === selectedIndex
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground hover:bg-muted'
          }`}
        >
          {item.id.startsWith('file:') ? (
            <Paperclip className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  )
})

MentionList.displayName = 'MentionList'
