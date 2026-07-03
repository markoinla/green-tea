import { describe, it, expect } from 'vitest'
import { ChatMessage, getToolDescription, getToolIcon, summarizeTools } from './ChatMessage'
import { AgentActivityGroup } from './AgentActivityGroup'
import { SubagentActivityGroup } from './SubagentActivityGroup'

const REACT_MEMO_TYPE = Symbol.for('react.memo')

// Streaming updates rebuild the messages array every token; these components
// must stay memoized or every settled message re-parses its markdown per token.
describe('chat message components are memoized', () => {
  it('ChatMessage is wrapped in React.memo', () => {
    expect((ChatMessage as unknown as { $$typeof: symbol }).$$typeof).toBe(REACT_MEMO_TYPE)
  })

  it('AgentActivityGroup is wrapped in React.memo with a custom comparator', () => {
    const memoized = AgentActivityGroup as unknown as { $$typeof: symbol; compare: unknown }
    expect(memoized.$$typeof).toBe(REACT_MEMO_TYPE)
    // ChatMessageList rebuilds the tools array per render, so a content
    // comparator is required — shallow compare would never hit.
    expect(typeof memoized.compare).toBe('function')
  })

  it('SubagentActivityGroup is wrapped in React.memo with a custom comparator', () => {
    const memoized = SubagentActivityGroup as unknown as { $$typeof: symbol; compare: unknown }
    expect(memoized.$$typeof).toBe(REACT_MEMO_TYPE)
    expect(typeof memoized.compare).toBe('function')
  })

  it('SubagentActivityGroup comparator never memoizes while running', () => {
    // subagentEvents arrays are mutated in place upstream, so a running group
    // must always re-render — memoizing it would freeze live updates.
    const memoized = SubagentActivityGroup as unknown as {
      compare: (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean
    }
    const base = {
      toolArgs: {},
      subagentEvents: [],
      resolveDocName: undefined,
      toolResult: undefined,
      toolIsError: undefined
    }
    expect(memoized.compare({ ...base, isRunning: true }, { ...base, isRunning: true })).toBe(false)
    expect(memoized.compare({ ...base, isRunning: false }, { ...base, isRunning: false })).toBe(
      true
    )
  })
})

describe('tool description helpers', () => {
  it('describes known tools', () => {
    expect(getToolDescription('notes_list')).toBe('Listing notes')
    expect(getToolDescription('bash', { command: 'ls -la' })).toBe('Running ls -la')
  })

  it('falls back for unknown tools', () => {
    expect(getToolDescription('mystery_tool')).toBe('Using mystery tool')
    expect(getToolIcon('mystery_tool')).toBeDefined()
  })

  it('summarizes tool batches into ordered count chips', () => {
    const summaries = summarizeTools([
      { toolName: 'bash' },
      { toolName: 'notes_get_markdown' },
      { toolName: 'notes_get_markdown' },
      { toolName: 'web_search' }
    ])
    expect(summaries.map((s) => s.label)).toEqual(['Read 2 notes', '1 web search', 'Ran 1 command'])
  })
})
