import { describe, it, expect } from 'vitest'
import { resolveSubagentEventKey } from './useAgentEvents'
import type { SubagentEvent } from '@renderer/components/chat/SubagentActivityGroup'

const noBuckets = new Map<string, SubagentEvent[]>()
const noActive = new Map<string, string>()

describe('resolveSubagentEventKey', () => {
  it('routes by parentToolCallId when its bucket exists', () => {
    const buckets = new Map<string, SubagentEvent[]>([
      ['call-a', []],
      ['call-b', []]
    ])
    const active = new Map([
      ['conv-a', 'call-a'],
      ['conv-b', 'call-b']
    ])
    const key = resolveSubagentEventKey(
      { conversationId: 'conv-a', parentToolCallId: 'call-a' },
      buckets,
      active,
      // global ref points at conversation B's call — must not win
      'call-b'
    )
    expect(key).toBe('call-a')
  })

  it('keeps concurrent conversations separate after the global ref is overwritten', () => {
    // Conv A spawned a subagent, then conv B spawned one (global ref -> call-b)
    const buckets = new Map<string, SubagentEvent[]>([
      ['call-a', []],
      ['call-b', []]
    ])
    const active = new Map([
      ['conv-a', 'call-a'],
      ['conv-b', 'call-b']
    ])
    const keyA = resolveSubagentEventKey(
      { conversationId: 'conv-a', parentToolCallId: 'call-a' },
      buckets,
      active,
      'call-b'
    )
    const keyB = resolveSubagentEventKey(
      { conversationId: 'conv-b', parentToolCallId: 'call-b' },
      buckets,
      active,
      'call-b'
    )
    expect(keyA).toBe('call-a')
    expect(keyB).toBe('call-b')
  })

  it('rolls nested subagent events up to the conversation-active outer call', () => {
    // Inner subagent tags with its own toolCallId, which has no bucket/card
    const buckets = new Map<string, SubagentEvent[]>([['outer-call', []]])
    const active = new Map([['conv-a', 'outer-call']])
    const key = resolveSubagentEventKey(
      { conversationId: 'conv-a', parentToolCallId: 'inner-call' },
      buckets,
      active,
      'outer-call'
    )
    expect(key).toBe('outer-call')
  })

  it('drops tagged events whose conversation has no active subagent (no misroute)', () => {
    const buckets = new Map<string, SubagentEvent[]>([['call-b', []]])
    const active = new Map([['conv-b', 'call-b']])
    const key = resolveSubagentEventKey(
      { conversationId: 'conv-a', parentToolCallId: 'call-gone' },
      buckets,
      active,
      'call-b'
    )
    expect(key).toBeNull()
  })

  it('falls back to the global ref for untagged (legacy) events', () => {
    const key = resolveSubagentEventKey({}, noBuckets, noActive, 'call-a')
    expect(key).toBe('call-a')
  })

  it('returns null for untagged events when nothing is active', () => {
    const key = resolveSubagentEventKey({}, noBuckets, noActive, null)
    expect(key).toBeNull()
  })
})
