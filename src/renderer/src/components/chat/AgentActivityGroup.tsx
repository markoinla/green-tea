import { useState } from 'react'
import { ChevronRight, AlertCircle, Loader2 } from 'lucide-react'
import { getToolDescription, getToolIcon } from './ChatMessage'

interface ToolMessage {
  id: string
  toolName: string
  toolArgs?: Record<string, unknown>
  toolResult?: string
  toolIsError?: boolean
}

interface AgentActivityGroupProps {
  tools: ToolMessage[]
  thinking?: string
  resolveDocName?: (id: string) => string
  showToolResults?: boolean
}

export function AgentActivityGroup({
  tools,
  thinking,
  resolveDocName,
  showToolResults
}: AgentActivityGroupProps) {
  const [expanded, setExpanded] = useState(false)

  const hasErrors = tools.some((t) => t.toolIsError)
  const hasPending = tools.some((t) => t.toolIsError === undefined)
  const lastTool = tools[tools.length - 1]
  let preview = ''
  if (lastTool) {
    const desc = getToolDescription(lastTool.toolName, lastTool.toolArgs, resolveDocName)
    preview =
      tools.length > 1
        ? `${tools.length} actions — ${desc.length > 30 ? desc.slice(0, 30) + '...' : desc}`
        : desc.length > 40
          ? desc.slice(0, 40) + '...'
          : desc
  } else if (thinking) {
    preview = thinking.length > 40 ? thinking.slice(0, 40) + '...' : thinking
  }

  return (
    <div className="my-1 rounded-lg bg-muted/40 border border-border/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs transition-colors py-1.5 px-2.5 w-full text-left text-muted-foreground hover:text-foreground overflow-hidden"
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
        />
        {expanded ? (
          <span>
            {tools.length > 0
              ? `${tools.length} ${tools.length === 1 ? 'action' : 'actions'}${hasErrors ? ' (has errors)' : ''}${thinking ? ' + thinking' : ''}`
              : 'Thinking'}
          </span>
        ) : (
          <>
            {hasPending && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60 flex-shrink-0" />
            )}
            <span className="truncate min-w-0">{preview}</span>
          </>
        )}
      </button>
      {expanded && (
        <div className="ml-4 border-l-2 border-accent/50 pl-2.5 pb-1.5">
          {thinking && (
            <div className="text-xs text-muted-foreground/70 py-1 px-1 whitespace-pre-wrap break-words max-h-48 overflow-y-auto italic">
              {thinking}
            </div>
          )}
          {tools.map((tool) => {
            const Icon = getToolIcon(tool.toolName)
            const desc = getToolDescription(tool.toolName, tool.toolArgs, resolveDocName)
            const isPending = tool.toolIsError === undefined
            return (
              <div key={tool.id} className="py-0.5 px-1">
                <div className="flex items-center gap-2">
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60 flex-shrink-0" />
                  ) : tool.toolIsError ? (
                    <AlertCircle className="h-3.5 w-3.5 text-destructive/70 flex-shrink-0" />
                  ) : (
                    <Icon className="h-3.5 w-3.5 text-muted-foreground/80 flex-shrink-0" />
                  )}
                  <span className="text-xs text-muted-foreground/80">{desc}</span>
                </div>
                {showToolResults && tool.toolIsError && tool.toolResult && (
                  <div className="ml-5 mt-0.5 text-xs text-muted-foreground/60 whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono bg-muted/30 rounded px-2 py-1">
                    {tool.toolResult}
                  </div>
                )}
                {showToolResults && !tool.toolIsError && tool.toolResult && (
                  <div className="ml-5 mt-0.5 text-xs text-muted-foreground/60 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                    {tool.toolResult}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
