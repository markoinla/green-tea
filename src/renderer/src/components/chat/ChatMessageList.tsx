import { useState, useEffect, memo, type RefObject, type MutableRefObject } from 'react'
import { MessageSquare } from 'lucide-react'
import { ChatMessage } from '@renderer/components/chat/ChatMessage'
import { AgentActivityGroup } from '@renderer/components/chat/AgentActivityGroup'
import {
  SubagentActivityGroup,
  type SubagentEvent
} from '@renderer/components/chat/SubagentActivityGroup'
import { PatchApproval } from '@renderer/components/diff/PatchApproval'
import type { DisplayItem } from '@renderer/hooks/chat-types'

const EMPTY_STATE_FLAVOR = [
  'Edit your notes with AI assistance',
  'Search across your entire workspace',
  'Ask questions about your documents',
  'Brainstorm ideas and organize thoughts',
  'Summarize long notes in seconds',
  'Connect ideas across documents',
  'Draft outlines from scratch',
  'Refine your writing with feedback'
]

function RotatingFlavorText(): React.ReactElement {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex((i) => (i + 1) % EMPTY_STATE_FLAVOR.length)
        setVisible(true)
      }, 300)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <p
      className="text-xs text-muted-foreground text-center max-w-[260px] leading-relaxed transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {EMPTY_STATE_FLAVOR[index]}
    </p>
  )
}

const AGENT_FLAVOR_TEXT = [
  'Thinking deeply',
  'Brewing thoughts',
  'Connecting dots',
  'Pondering',
  'Mulling it over',
  'Chewing on that',
  'Sifting through ideas',
  'Steeping',
  'Working through it',
  'Turning gears',
  'On it',
  'Noodling',
  'Piecing things together',
  'Letting it simmer',
  'Reading the tea leaves',
  'Unpacking that',
  'Mapping it out',
  'Weighing options',
  'Following the thread'
]

const AgentThinkingIndicator = memo(function AgentThinkingIndicator({
  startTime
}: {
  startTime: number
}) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * AGENT_FLAVOR_TEXT.length))
  const [visible, setVisible] = useState(true)
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startTime) / 1000))

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex((i) => (i + 1) % AGENT_FLAVOR_TEXT.length)
        setVisible(true)
      }, 300)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [startTime])

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60)
    const secs = s % 60
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="h-6 w-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
        <div className="flex gap-0.5">
          <span
            className="w-1 h-1 rounded-full bg-accent-foreground animate-bounce"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="w-1 h-1 rounded-full bg-accent-foreground animate-bounce"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="w-1 h-1 rounded-full bg-accent-foreground animate-bounce"
            style={{ animationDelay: '300ms' }}
          />
        </div>
      </div>
      <span
        className="text-xs text-muted-foreground transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {AGENT_FLAVOR_TEXT[index]}
      </span>
      {elapsed >= 5 && (
        <span className="text-xs text-muted-foreground/70 tabular-nums ml-auto animate-in fade-in duration-500 rounded-lg bg-muted/40 border border-border/50 px-2 py-0.5">
          {formatTime(elapsed)}
        </span>
      )}
    </div>
  )
})

interface ChatMessageListProps {
  displayItems: DisplayItem[]
  isStreaming: boolean
  activeConversationId: string | null
  streamingStartTime: number | undefined
  subagentEventsRef: MutableRefObject<Map<string, SubagentEvent[]>>
  subagentEventVersion: number
  activeSubagentToolCallId: MutableRefObject<string | null>
  resolveDocName: (id: string) => string
  showToolResults: boolean
  onApprovePatch: (logId: string) => void
  onRejectPatch: (logId: string) => void
  messagesEndRef: RefObject<HTMLDivElement | null>
}

export function ChatMessageList({
  displayItems,
  isStreaming,
  activeConversationId,
  streamingStartTime,
  subagentEventsRef,
  subagentEventVersion,
  activeSubagentToolCallId,
  resolveDocName,
  showToolResults,
  onApprovePatch,
  onRejectPatch,
  messagesEndRef
}: ChatMessageListProps) {
  if (displayItems.length === 0 && !isStreaming) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-forwards">
        <div className="w-12 h-12 rounded-2xl bg-primary/5 flex items-center justify-center mb-5 ring-1 ring-inset ring-primary/10">
          <MessageSquare className="h-6 w-6 text-primary/60" />
        </div>
        <h3 className="text-sm font-medium text-foreground mb-1.5">How can I help?</h3>
        <RotatingFlavorText />
      </div>
    )
  }

  return (
    <>
      {displayItems.map((item) => {
        if (item.type === 'activity-group') {
          // Check if this group contains a subagent tool call
          const subagentTool = item.tools.find((t) => t.toolName === 'subagent')
          if (subagentTool) {
            const events = subagentEventsRef.current.get(subagentTool.toolCallId || '') || []
            const isRunning = activeSubagentToolCallId.current === subagentTool.toolCallId
            // Reference subagentEventVersion to trigger re-renders
            void subagentEventVersion
            return (
              <SubagentActivityGroup
                key={item.id}
                toolArgs={subagentTool.toolArgs || {}}
                toolResult={subagentTool.toolResult}
                toolIsError={subagentTool.toolIsError}
                subagentEvents={events}
                isRunning={isRunning}
                resolveDocName={resolveDocName}
              />
            )
          }

          return (
            <AgentActivityGroup
              key={item.id}
              tools={item.tools.map((t) => ({
                id: t.id,
                toolName: t.toolName!,
                toolArgs: t.toolArgs,
                toolResult: t.toolResult,
                toolIsError: t.toolIsError
              }))}
              thinking={item.thinking}
              resolveDocName={resolveDocName}
              showToolResults={showToolResults}
            />
          )
        }
        const msg = item.message
        return (
          <div key={msg.id}>
            <ChatMessage
              role={msg.role}
              content={msg.content}
              thinking={msg.thinking}
              timestamp={msg.timestamp}
              toolName={msg.toolName}
              toolArgs={msg.toolArgs}
              images={msg.images}
              files={msg.files}
              resolveDocName={resolveDocName}
            />
            {msg.patchLogId && msg.patchDiff && (
              <PatchApproval
                logId={msg.patchLogId}
                diff={msg.patchDiff}
                onApprove={onApprovePatch}
                onReject={onRejectPatch}
              />
            )}
          </div>
        )
      })}
      {isStreaming && (
        <AgentThinkingIndicator
          startTime={(activeConversationId && streamingStartTime) || Date.now()}
        />
      )}
      <div ref={messagesEndRef} />
    </>
  )
}
