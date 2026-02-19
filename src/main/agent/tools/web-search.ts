import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'

const PROXY_SEARCH_URL = 'https://greentea-proxy.m-6bb.workers.dev/v1/search'

interface TavilyResult {
  title: string
  url: string
  content: string
  score: number
}

interface TavilyResponse {
  query: string
  answer?: string
  results: TavilyResult[]
}

export function createWebSearchTool(): ToolDefinition {
  return {
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web for real-time information. Use this when you need current data, recent events, up-to-date documentation, or any information that may be beyond your training data.',
    parameters: Type.Object({
      query: Type.String({ description: 'The search query to perform' }),
      max_results: Type.Optional(
        Type.Number({
          description: 'Maximum number of results to return (default: 5, max: 10)',
          minimum: 1,
          maximum: 10
        })
      )
    }),
    async execute(_toolCallId, params) {
      const p = params as { query: string; max_results?: number }

      try {
        const response = await fetch(PROXY_SEARCH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: p.query,
            max_results: p.max_results ?? 5
          })
        })

        if (!response.ok) {
          const text = await response.text()
          return {
            content: [
              { type: 'text' as const, text: `Web search error (${response.status}): ${text}` }
            ],
            details: undefined
          }
        }

        const data = (await response.json()) as TavilyResponse

        let result = ''

        if (data.answer) {
          result += data.answer + '\n\n'
        }

        if (data.results && data.results.length > 0) {
          result += 'Search Results:\n'
          for (const r of data.results) {
            result += `\n### ${r.title}\n${r.content}\nSource: ${r.url}\n`
          }
        }

        if (!result) {
          result = 'No results found for this query.'
        }

        return {
          content: [{ type: 'text' as const, text: result.trim() }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Web search error: ${message}` }],
          details: undefined
        }
      }
    }
  }
}
