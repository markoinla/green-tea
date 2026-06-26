import { describe, it, expect } from 'vitest'
import { chatReducer, groupMessages, type ChatState } from './chat-types'

const base: ChatState = { messages: [], isStreaming: false }

// Simulates the event order when a tool call is surfaced *during* streaming
// (message_update -> upsert_tool_call) and then reconciled at execution
// (tool_start -> upsert_tool_call, tool_end -> update_tool_result).
describe('tool calls surfaced during streaming', () => {
  it('shows a pending tool card before execution and never duplicates it', () => {
    let state = base

    // message_start: empty assistant text placeholder
    state = chatReducer(state, {
      type: 'add_message',
      message: { id: 'text-1', role: 'assistant', content: '', timestamp: 1 }
    })

    // message_update: text streams in
    state = chatReducer(state, { type: 'set_last_assistant_content', content: 'Let me check' })

    // message_update: tool call starts streaming (name known, args still partial)
    state = chatReducer(state, {
      type: 'upsert_tool_call',
      id: 'card-1',
      timestamp: 2,
      toolCallId: 'tc-1',
      toolName: 'notes_search',
      toolArgs: {}
    })

    // The card exists and is pending (toolIsError === undefined) before execution
    let tool = state.messages.find((m) => m.toolCallId === 'tc-1')
    expect(tool).toBeDefined()
    expect(tool?.toolIsError).toBeUndefined()

    // More text streams — must still target the text bubble, not the tool card
    state = chatReducer(state, { type: 'set_last_assistant_content', content: 'Let me check the notes' })
    expect(state.messages.find((m) => m.id === 'text-1')?.content).toBe('Let me check the notes')

    // args finish streaming
    state = chatReducer(state, {
      type: 'upsert_tool_call',
      id: 'card-x',
      timestamp: 3,
      toolCallId: 'tc-1',
      toolName: 'notes_search',
      toolArgs: { query: 'tea' }
    })

    // tool_start at execution: upsert reconciles, does not add a duplicate
    state = chatReducer(state, {
      type: 'upsert_tool_call',
      id: 'card-y',
      timestamp: 4,
      toolCallId: 'tc-1',
      toolName: 'notes_search',
      toolArgs: { query: 'tea' }
    })
    expect(state.messages.filter((m) => m.toolCallId === 'tc-1')).toHaveLength(1)

    // tool_end: result reconciles by toolCallId
    state = chatReducer(state, {
      type: 'update_tool_result',
      toolCallId: 'tc-1',
      result: 'found 3',
      isError: false
    })
    tool = state.messages.find((m) => m.toolCallId === 'tc-1')
    expect(tool?.toolArgs).toEqual({ query: 'tea' })
    expect(tool?.toolIsError).toBe(false)
    expect(tool?.toolResult).toBe('found 3')

    // Grouping: empty placeholder is dropped only if no text; here text bubble + tool card
    const items = groupMessages(state.messages)
    expect(items.map((i) => i.type)).toEqual(['message', 'activity-group'])
  })

  it('targets the text bubble even when a tool card is the most recent message', () => {
    let state: ChatState = {
      ...base,
      messages: [
        { id: 'text-1', role: 'assistant', content: 'thinking', timestamp: 1 },
        {
          id: 'card-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolName: 'notes_list',
          toolCallId: 'tc-1'
        }
      ]
    }

    state = chatReducer(state, { type: 'set_last_assistant_content', content: 'updated text' })

    expect(state.messages.find((m) => m.id === 'text-1')?.content).toBe('updated text')
    // tool card content untouched
    expect(state.messages.find((m) => m.id === 'card-1')?.content).toBe('')
  })
})
