import { Quote, X } from 'lucide-react'

interface ChatInputSelectionBadgeProps {
  selectionContext: string
  onClearSelection?: () => void
}

export function ChatInputSelectionBadge({
  selectionContext,
  onClearSelection
}: ChatInputSelectionBadgeProps) {
  return (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1">
      <div className="flex items-center gap-1.5 min-w-0 flex-1 px-2 py-1 rounded-lg bg-background/50 border border-border/50 text-xs">
        <Quote className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        <span className="truncate text-muted-foreground">
          {selectionContext.length > 40 ? selectionContext.slice(0, 40) + '...' : selectionContext}
        </span>
        <span className="text-muted-foreground/50 flex-shrink-0">
          ({selectionContext.length} chars)
        </span>
        <button
          type="button"
          onClick={onClearSelection}
          className="ml-auto flex-shrink-0 h-4 w-4 rounded flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
