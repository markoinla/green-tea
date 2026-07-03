import { memo, useState } from 'react'
import { ChevronRight, AlertCircle, Users } from 'lucide-react'
import { getToolDescription, getToolIcon } from './ChatMessage'

export interface SubagentEvent {
  type: string
  agentName?: string
  toolName?: string
  toolCallId?: string
  args?: Record<string, unknown>
  result?: unknown
  isError?: boolean
}

interface SubagentActivityGroupProps {
  toolArgs: Record<string, unknown>
  toolResult?: string
  toolIsError?: boolean
  subagentEvents: SubagentEvent[]
  isRunning: boolean
  resolveDocName?: (id: string) => string
}

function truncate(s: string, max = 40): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function getModeSummary(args: Record<string, unknown>): string {
  if (args.agent) {
    const task = String(args.task || '')
    if (task) return `${args.agent}: ${truncate(task, 35)}`
    return `${args.agent}`
  }
  if (args.tasks) return `${(args.tasks as unknown[]).length} parallel agents`
  if (args.chain) return `${(args.chain as unknown[]).length}-step chain`
  return 'subagent'
}

// The subagentEvents array is mutated in place by useAgentEvents (events are
// pushed into the same array), so prev/next props can share one reference with
// different contents — no prop comparison can detect that. While running we
// always re-render (live updates); only settled groups memoize, at which point
// the events array no longer changes.
function propsAreEqual(
  prev: SubagentActivityGroupProps,
  next: SubagentActivityGroupProps
): boolean {
  if (prev.isRunning || next.isRunning) return false
  // ChatMessageList passes fresh `{}` / `[]` fallbacks per render — treat empty
  // as equal; otherwise identity tracks content (reducer replaces on change).
  const argsEqual =
    prev.toolArgs === next.toolArgs ||
    (Object.keys(prev.toolArgs).length === 0 && Object.keys(next.toolArgs).length === 0)
  const eventsEqual =
    prev.subagentEvents === next.subagentEvents ||
    (prev.subagentEvents.length === 0 && next.subagentEvents.length === 0)
  return (
    argsEqual &&
    eventsEqual &&
    prev.toolResult === next.toolResult &&
    prev.toolIsError === next.toolIsError &&
    prev.resolveDocName === next.resolveDocName
  )
}

export const SubagentActivityGroup = memo(function SubagentActivityGroup({
  toolArgs,
  toolResult,
  toolIsError,
  subagentEvents,
  isRunning,
  resolveDocName
}: SubagentActivityGroupProps) {
  const [expanded, setExpanded] = useState(isRunning)

  const agentName = (toolArgs.agent as string) || 'subagent'
  const modeSummary = getModeSummary(toolArgs)

  // Count completed tool actions from events
  const toolEvents = subagentEvents.filter(
    (e) => e.type === 'tool_execution_start' || e.type === 'tool_execution_end'
  )
  const startEvents = subagentEvents.filter((e) => e.type === 'tool_execution_start')
  const actionCount = startEvents.length

  // Build inner tool call list from start events
  const innerTools = startEvents.map((e) => ({
    id: e.toolCallId || crypto.randomUUID(),
    toolName: e.toolName || 'unknown',
    args: e.args,
    hasError: toolEvents.some(
      (end) => end.type === 'tool_execution_end' && end.toolCallId === e.toolCallId && end.isError
    )
  }))

  const hasErrors = toolIsError || innerTools.some((t) => t.hasError)
  const statusText = isRunning ? 'running...' : hasErrors ? 'error' : 'done'

  // Summary line when collapsed
  const summaryText = isRunning
    ? `${modeSummary} - ${statusText}`
    : `${modeSummary} - ${actionCount} ${actionCount === 1 ? 'action' : 'actions'}`

  return (
    <div className="my-1 rounded-lg bg-violet-500/5 border border-violet-500/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs transition-colors py-1.5 px-2.5 w-full text-left text-muted-foreground hover:text-foreground overflow-hidden"
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
        />
        <Users className="h-3.5 w-3.5 flex-shrink-0 text-violet-500" />
        {expanded ? (
          <span>
            {agentName}
            <span className="text-muted-foreground/60 ml-1">({statusText})</span>
          </span>
        ) : (
          <span className="truncate min-w-0">{summaryText}</span>
        )}
        {isRunning && (
          <span className="ml-auto flex gap-0.5">
            <span
              className="w-1 h-1 rounded-full bg-violet-500 animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-1 h-1 rounded-full bg-violet-500 animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="w-1 h-1 rounded-full bg-violet-500 animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </span>
        )}
      </button>
      {expanded && (
        <div className="ml-4 border-l-2 border-violet-500/40 pl-2.5 pb-1.5">
          {innerTools.map((tool) => {
            const Icon = getToolIcon(tool.toolName)
            const desc = getToolDescription(tool.toolName, tool.args, resolveDocName)
            return (
              <div key={tool.id} className="py-0.5 px-1">
                <div className="flex items-center gap-2">
                  {tool.hasError ? (
                    <AlertCircle className="h-3.5 w-3.5 text-destructive/70 flex-shrink-0" />
                  ) : (
                    <Icon className="h-3.5 w-3.5 text-muted-foreground/80 flex-shrink-0" />
                  )}
                  <span className="text-xs text-muted-foreground/80">{desc}</span>
                </div>
              </div>
            )
          })}
          {isRunning && innerTools.length === 0 && (
            <div className="py-0.5 px-1 text-xs text-muted-foreground/60 italic">Starting...</div>
          )}
          {!isRunning && toolResult && (
            <div className="py-0.5 px-1 text-xs text-muted-foreground/60 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
              {toolResult.length > 200 ? toolResult.slice(0, 200) + '...' : toolResult}
            </div>
          )}
        </div>
      )}
    </div>
  )
}, propsAreEqual)
