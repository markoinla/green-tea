import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { flushSync } from 'react-dom'
import type { SubagentEvent } from '@renderer/components/chat/SubagentActivityGroup'
import type { ChatAction } from './chat-types'

interface UseAgentEventsOpts {
  dispatchTo: (conversationId: string, action: ChatAction) => void
}

interface UseAgentEventsResult {
  subagentEventsRef: MutableRefObject<Map<string, SubagentEvent[]>>
  subagentEventVersion: number
  activeSubagentToolCallId: MutableRefObject<string | null>
  streamingStartTimeRef: MutableRefObject<Map<string, number>>
}

export function useAgentEvents({ dispatchTo }: UseAgentEventsOpts): UseAgentEventsResult {
  const streamingStartTimeRef = useRef<Map<string, number>>(new Map())
  const subagentEventsRef = useRef<Map<string, SubagentEvent[]>>(new Map())
  const [subagentEventVersion, setSubagentEventVersion] = useState(0)
  const activeSubagentToolCallId = useRef<string | null>(null)

  // Subscribe to subagent events and accumulate them
  useEffect(() => {
    const unsub = window.api.agent.onSubagentEvent((data: unknown) => {
      const event = data as SubagentEvent
      const key = activeSubagentToolCallId.current
      if (!key) return

      const existing = subagentEventsRef.current.get(key) || []
      existing.push(event)
      subagentEventsRef.current.set(key, existing)
      setSubagentEventVersion((v) => v + 1)
    })
    return unsub
  }, [])

  // Route agent events by conversationId
  useEffect(() => {
    const unsub = window.api.agent.onEvent((data: unknown) => {
      const event = data as {
        type: string
        conversationId?: string
        message?: {
          role: string
          content: Array<{
            type: string
            text?: string
            thinking?: string
            // tool-use blocks while the assistant message streams
            id?: string
            name?: string
            arguments?: Record<string, unknown>
          }>
        }
        toolCallId?: string
        toolName?: string
        args?: Record<string, unknown>
        result?: {
          content?: unknown
          details?: {
            id?: string
            output_patch?: string
            document_id?: string
            action_type?: string
            metadata_payload?: string
          }
        }
        isError?: boolean
        tokens?: { input: number; output: number; total: number }
      }

      const convId = event.conversationId
      if (!convId) return

      switch (event.type) {
        case 'agent_start':
          streamingStartTimeRef.current.set(convId, Date.now())
          dispatchTo(convId, { type: 'set_streaming', streaming: true })
          break

        case 'message_start': {
          if (event.message?.role === 'assistant') {
            dispatchTo(convId, {
              type: 'add_message',
              message: {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: '',
                timestamp: Date.now()
              }
            })
          }
          break
        }

        case 'message_update':
        case 'message_end': {
          if (event.message?.role === 'assistant' && event.message.content) {
            const textParts = event.message.content
              .filter((c) => c.type === 'text' && c.text)
              .map((c) => c.text || '')
            const fullText = textParts.join('')

            const thinkingParts = event.message.content
              .filter((c) => c.type === 'thinking' && c.thinking)
              .map((c) => c.thinking || '')
            const thinkingText = thinkingParts.join('\n')

            dispatchTo(convId, {
              type: 'set_last_assistant_content',
              content: fullText,
              thinking: thinkingText || undefined
            })

            // Surface tool calls as soon as the model starts writing them (during
            // streaming), instead of waiting for execution to begin. Args fill in
            // progressively as the streamed JSON is parsed.
            for (const block of event.message.content) {
              if (block.type === 'toolCall' && block.id && block.name) {
                dispatchTo(convId, {
                  type: 'upsert_tool_call',
                  id: crypto.randomUUID(),
                  timestamp: Date.now(),
                  toolCallId: block.id,
                  toolName: block.name,
                  toolArgs: block.arguments
                })
              }
            }

            // Persist assistant text message on message_end
            if (event.type === 'message_end' && fullText) {
              window.api.conversations.addMessage({
                conversation_id: convId,
                role: 'assistant',
                content: fullText,
                thinking: thinkingText || undefined
              })
            }
          }
          break
        }

        case 'tool_start': {
          if (event.toolName) {
            const toolName = event.toolName
            // Track active subagent invocation for event routing
            if (event.toolName === 'subagent' && event.toolCallId) {
              activeSubagentToolCallId.current = event.toolCallId
              subagentEventsRef.current.set(event.toolCallId, [])
            }

            // The card was likely already added while the tool call streamed (see
            // message_update). Upsert reconciles with it by toolCallId so we update
            // the existing pending card instead of adding a duplicate; if streaming
            // never produced one, this adds it now.
            //
            // flushSync forces React to render the activity group immediately,
            // preventing it from being batched with the upcoming tool_end event.
            // Without this, fast/synchronous tools would have tool_start and tool_end
            // batched into a single render — the user would never see the "running" state.
            flushSync(() => {
              if (event.toolCallId) {
                dispatchTo(convId, {
                  type: 'upsert_tool_call',
                  id: crypto.randomUUID(),
                  timestamp: Date.now(),
                  toolCallId: event.toolCallId,
                  toolName,
                  toolArgs: event.args
                })
              } else {
                dispatchTo(convId, {
                  type: 'add_message',
                  message: {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: '',
                    timestamp: Date.now(),
                    toolName,
                    toolArgs: event.args
                  }
                })
              }
            })

            // Persist tool message
            window.api.conversations.addMessage({
              conversation_id: convId,
              role: 'assistant',
              content: '',
              tool_name: event.toolName,
              tool_args: event.args ? JSON.stringify(event.args) : undefined,
              tool_call_id: event.toolCallId
            })
          }
          break
        }

        case 'tool_end': {
          // Clear active subagent tracking when subagent tool finishes
          if (
            event.toolName === 'subagent' &&
            event.toolCallId === activeSubagentToolCallId.current
          ) {
            activeSubagentToolCallId.current = null
            setSubagentEventVersion((v) => v + 1)
          }

          // Capture tool result/error for display
          if (event.toolCallId) {
            let resultText: string | undefined
            if (event.result?.content) {
              const content = event.result.content as Array<{ type: string; text?: string }>
              resultText = content
                .filter((c) => c.type === 'text' && c.text)
                .map((c) => c.text)
                .join('\n')
            }
            dispatchTo(convId, {
              type: 'update_tool_result',
              toolCallId: event.toolCallId,
              result: resultText,
              isError: event.isError
            })
          }

          // Edit approval UI
          if (event.toolName === 'notes_propose_edit' && !event.isError && event.result?.details) {
            const details = event.result.details
            if (details.id && details.output_patch) {
              dispatchTo(convId, {
                type: 'add_message',
                message: {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: 'I have proposed an edit for your review:',
                  timestamp: Date.now(),
                  patchLogId: details.id,
                  patchDiff: details.output_patch,
                  patchDocumentId: details.document_id
                }
              })

              // Persist edit message
              window.api.conversations.addMessage({
                conversation_id: convId,
                role: 'assistant',
                content: 'I have proposed an edit for your review:',
                patch_log_id: details.id,
                patch_diff: details.output_patch,
                patch_document_id: details.document_id
              })
            }
          }

          // Metadata approval UI (Phase 5) — a NON-diff approval card.
          if (event.toolName === 'notes_set_metadata' && !event.isError && event.result?.details) {
            const details = event.result.details
            if (details.id && details.metadata_payload) {
              let payload: { document_id: string; changedKeys: Record<string, unknown> }[] = []
              try {
                payload = JSON.parse(details.metadata_payload)
              } catch {
                payload = []
              }
              if (payload.length > 0) {
                dispatchTo(convId, {
                  type: 'add_message',
                  message: {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: 'I have proposed a metadata change for your review:',
                    timestamp: Date.now(),
                    metadataLogId: details.id,
                    metadataPayload: payload
                  }
                })

                window.api.conversations.addMessage({
                  conversation_id: convId,
                  role: 'assistant',
                  content: 'I have proposed a metadata change for your review:',
                  metadata_log_id: details.id,
                  metadata_payload: details.metadata_payload
                })
              }
            }
          }
          break
        }

        case 'agent_end': {
          streamingStartTimeRef.current.delete(convId)
          dispatchTo(convId, { type: 'set_streaming', streaming: false })
          if (event.tokens) {
            dispatchTo(convId, { type: 'set_tokens', tokens: event.tokens })
          }
          break
        }
      }
    })

    return unsub
  }, [dispatchTo])

  return {
    subagentEventsRef,
    subagentEventVersion,
    activeSubagentToolCallId,
    streamingStartTimeRef
  }
}
