import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { discoverAgents, type AgentConfig } from './agents'
import { runSubagent } from './session-factory'

const MAX_PARALLEL_TASKS = 8
const MAX_CONCURRENCY = 4

async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await fn(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function formatAgentList(agents: Map<string, AgentConfig>): string {
  if (agents.size === 0) return 'No agents found. Create .md files in ~/.greentea/agents/'
  const lines = ['Available agents:']
  for (const [name, config] of agents) {
    lines.push(`  - ${name}: ${config.description}`)
    if (config.model) lines.push(`    model: ${config.model}`)
    if (config.tools) lines.push(`    tools: ${config.tools.join(', ')}`)
  }
  return lines.join('\n')
}

export function createSubagentTool(
  db: Database.Database,
  window: BrowserWindow,
  workspaceId?: string
): ToolDefinition {
  return {
    name: 'subagent',
    label: 'Subagent',
    description: `Delegate tasks to sub-agents with isolated context windows. Modes:
- Single: set "agent" + "task"
- Parallel: set "tasks" array (up to ${MAX_PARALLEL_TASKS}, ${MAX_CONCURRENCY} concurrent)
- Chain: set "chain" array — sequential, use {previous} to reference prior step output
Agents are defined in ~/.greentea/agents/*.md. Use exactly one mode per call.`,

    parameters: Type.Object({
      // Single mode
      agent: Type.Optional(Type.String({ description: 'Agent name for single mode' })),
      task: Type.Optional(Type.String({ description: 'Task description for single mode' })),
      // Parallel mode
      tasks: Type.Optional(
        Type.Array(
          Type.Object({
            agent: Type.String({ description: 'Agent name' }),
            task: Type.String({ description: 'Task description' })
          }),
          { description: 'Array of agent/task pairs for parallel execution' }
        )
      ),
      // Chain mode
      chain: Type.Optional(
        Type.Array(
          Type.Object({
            agent: Type.String({ description: 'Agent name' }),
            task: Type.String({
              description: 'Task description. Use {previous} to reference the previous step output.'
            })
          }),
          { description: 'Sequential pipeline of agent/task pairs' }
        )
      )
    }),

    async execute(_toolCallId, params, signal) {
      const p = params as {
        agent?: string
        task?: string
        tasks?: { agent: string; task: string }[]
        chain?: { agent: string; task: string }[]
      }

      // Discover agents fresh each time (allows editing mid-session)
      const agents = discoverAgents(db)

      // Determine mode
      const modes = [
        p.agent && p.task ? 'single' : null,
        p.tasks ? 'parallel' : null,
        p.chain ? 'chain' : null
      ].filter(Boolean)

      if (modes.length !== 1) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Specify exactly one mode — single (agent+task), parallel (tasks), or chain (chain).\n\n${formatAgentList(agents)}`
            }
          ],
          details: undefined,
          isError: true
        }
      }

      const mode = modes[0]!

      // --- Single mode ---
      if (mode === 'single') {
        const agentConfig = agents.get(p.agent!)
        if (!agentConfig) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Unknown agent "${p.agent}".\n\n${formatAgentList(agents)}`
              }
            ],
            details: undefined,
            isError: true
          }
        }

        const result = await runSubagent(db, window, agentConfig, p.task!, workspaceId, signal)

        return {
          content: [{ type: 'text' as const, text: result.output }],
          details: undefined,
          isError: result.isError
        }
      }

      // --- Parallel mode ---
      if (mode === 'parallel') {
        const taskList = p.tasks!
        if (taskList.length > MAX_PARALLEL_TASKS) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Maximum ${MAX_PARALLEL_TASKS} parallel tasks allowed, got ${taskList.length}.`
              }
            ],
            details: undefined,
            isError: true
          }
        }

        // Validate all agents exist
        for (const t of taskList) {
          if (!agents.has(t.agent)) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: Unknown agent "${t.agent}".\n\n${formatAgentList(agents)}`
                }
              ],
              details: undefined,
              isError: true
            }
          }
        }

        const results = await mapWithConcurrencyLimit(taskList, MAX_CONCURRENCY, async (t) => {
          const agentConfig = agents.get(t.agent)!
          return runSubagent(db, window, agentConfig, t.task, workspaceId, signal)
        })

        const outputParts = results.map((r, i) => {
          const t = taskList[i]
          const status = r.isError ? 'ERROR' : 'OK'
          return `## Task ${i + 1} [${t.agent}] — ${status}\n\n${r.output}`
        })

        const anyError = results.some((r) => r.isError)

        return {
          content: [{ type: 'text' as const, text: outputParts.join('\n\n---\n\n') }],
          details: undefined,
          isError: anyError
        }
      }

      // --- Chain mode ---
      if (mode === 'chain') {
        const chainSteps = p.chain!

        // Validate all agents exist
        for (const step of chainSteps) {
          if (!agents.has(step.agent)) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: Unknown agent "${step.agent}".\n\n${formatAgentList(agents)}`
                }
              ],
              details: undefined,
              isError: true
            }
          }
        }

        let previousOutput = ''
        const stepOutputs: string[] = []

        for (let i = 0; i < chainSteps.length; i++) {
          const step = chainSteps[i]
          const agentConfig = agents.get(step.agent)!

          // Substitute {previous} placeholder
          const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput)

          const result = await runSubagent(
            db,
            window,
            agentConfig,
            taskWithContext,
            workspaceId,
            signal
          )

          stepOutputs.push(
            `## Step ${i + 1} [${step.agent}] — ${result.isError ? 'ERROR' : 'OK'}\n\n${result.output}`
          )

          if (result.isError) {
            stepOutputs.push(`\n\nChain halted at step ${i + 1} due to error.`)
            return {
              content: [{ type: 'text' as const, text: stepOutputs.join('\n\n---\n\n') }],
              details: undefined,
              isError: true
            }
          }

          previousOutput = result.output
        }

        return {
          content: [{ type: 'text' as const, text: stepOutputs.join('\n\n---\n\n') }],
          details: undefined,
          isError: false
        }
      }

      // Should not reach here
      return {
        content: [{ type: 'text' as const, text: 'Error: Unknown mode.' }],
        details: undefined,
        isError: true
      }
    }
  }
}
