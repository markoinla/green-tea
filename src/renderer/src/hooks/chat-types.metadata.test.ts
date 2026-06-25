import { describe, it, expect } from 'vitest'
import { chatReducer, groupMessages, type ChatState, type Message } from './chat-types'

const base: ChatState = { messages: [], isStreaming: false }

function metadataMessage(): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'I have proposed a metadata change for your review:',
    timestamp: 1,
    metadataLogId: 'log-1',
    metadataPayload: [{ document_id: 'doc-1', changedKeys: { status: 'done', tags: ['x'] } }]
  }
}

describe('metadata proposal message drives a standalone approval card', () => {
  it('a message carrying metadataLogId/metadataPayload is a regular (non-tool) display item', () => {
    const items = groupMessages([metadataMessage()])
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('message')
    if (items[0].type === 'message') {
      expect(items[0].message.metadataLogId).toBe('log-1')
      expect(items[0].message.metadataPayload).toHaveLength(1)
    }
  })

  it('remove_metadata clears the card fields on accept/reject without dropping the message', () => {
    let state: ChatState = { ...base, messages: [metadataMessage()] }
    state = chatReducer(state, { type: 'remove_metadata', logId: 'log-1' })
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].metadataLogId).toBeUndefined()
    expect(state.messages[0].metadataPayload).toBeUndefined()
    // The message text is preserved (only the card is removed).
    expect(state.messages[0].content).toContain('metadata change')
  })

  it('remove_metadata only affects the matching log', () => {
    const other = { ...metadataMessage(), id: 'm2', metadataLogId: 'log-2' }
    let state: ChatState = { ...base, messages: [metadataMessage(), other] }
    state = chatReducer(state, { type: 'remove_metadata', logId: 'log-1' })
    expect(state.messages[0].metadataLogId).toBeUndefined()
    expect(state.messages[1].metadataLogId).toBe('log-2')
  })

  it('remove_patch does not touch metadata fields and vice versa', () => {
    let state: ChatState = { ...base, messages: [metadataMessage()] }
    state = chatReducer(state, { type: 'remove_patch', logId: 'log-1' })
    expect(state.messages[0].metadataLogId).toBe('log-1')
  })
})
