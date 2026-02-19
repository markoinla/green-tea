import { FileText, X } from 'lucide-react'

interface ChatInputPastedTextBadgeProps {
  pastedText: string
  onClear: () => void
}

export function ChatInputPastedTextBadge({ pastedText, onClear }: ChatInputPastedTextBadgeProps) {
  return (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1">
      <div className="flex items-center gap-1.5 min-w-0 flex-1 px-2.5 py-2 rounded-lg bg-background/50 border border-border/50 text-xs group">
        <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="truncate text-muted-foreground">
          {pastedText.length > 40 ? pastedText.slice(0, 40) + '...' : pastedText}
        </span>
        <span className="text-muted-foreground/50 flex-shrink-0 whitespace-nowrap ml-auto">
          {pastedText.length >= 1000
            ? `${(pastedText.length / 1000).toFixed(1)}K`
            : pastedText.length}{' '}
          chars
        </span>
        <button
          type="button"
          onClick={onClear}
          className="h-4 w-4 rounded-full flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  )
}
