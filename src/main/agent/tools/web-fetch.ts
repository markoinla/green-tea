import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

const DEFAULT_MAX_LENGTH = 50_000

const JUNK_SELECTORS = [
  'script',
  'style',
  'nav',
  'footer',
  'header',
  'aside',
  'iframe',
  'noscript',
  'svg',
  'form',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '.nav',
  '.navbar',
  '.footer',
  '.sidebar',
  '.menu',
  '.ad',
  '.ads',
  '.advertisement'
]

export function createWebFetchTool(): ToolDefinition {
  return {
    name: 'web_fetch',
    label: 'Web Fetch',
    description:
      'Fetch a web page and extract its content as Markdown. Use this to read documentation, articles, blog posts, or any text-heavy web page. Best used after web_search to read specific URLs from search results.',
    parameters: Type.Object({
      url: Type.String({ description: 'The URL to fetch' }),
      max_length: Type.Optional(
        Type.Number({
          description:
            'Maximum character length of returned content (default: 50000). Reduce for shorter pages to save context.',
          minimum: 1000,
          maximum: 100_000
        })
      )
    }),
    async execute(_toolCallId, params) {
      const p = params as { url: string; max_length?: number }
      const maxLength = p.max_length ?? DEFAULT_MAX_LENGTH

      try {
        const response = await fetch(p.url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          signal: AbortSignal.timeout(15_000)
        })

        if (!response.ok) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: HTTP ${response.status} ${response.statusText} fetching ${p.url}`
              }
            ],
            details: undefined
          }
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: URL returned non-HTML content (${contentType}). This tool only works with HTML pages.`
              }
            ],
            details: undefined
          }
        }

        const html = await response.text()
        const { document } = parseHTML(html)

        // Strip junk elements
        for (const selector of JUNK_SELECTORS) {
          for (const el of document.querySelectorAll(selector)) {
            el.remove()
          }
        }

        // Get the main content area, or fall back to body
        const main =
          document.querySelector('main') ??
          document.querySelector('article') ??
          document.querySelector('[role="main"]') ??
          document.body

        if (!main || !main.innerHTML.trim()) {
          return {
            content: [
              { type: 'text' as const, text: 'Error: No readable content found on the page.' }
            ],
            details: undefined
          }
        }

        const turndown = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
          bulletListMarker: '-'
        })

        let markdown = turndown.turndown(main.innerHTML)

        // Clean up excessive blank lines
        markdown = markdown.replace(/\n{3,}/g, '\n\n').trim()

        let truncated = false
        if (markdown.length > maxLength) {
          markdown = markdown.slice(0, maxLength)
          truncated = true
        }

        const title = document.querySelector('title')?.textContent?.trim()
        let result = ''
        if (title) {
          result += `# ${title}\n\n`
        }
        result += `Source: ${p.url}\n\n`
        result += markdown
        if (truncated) {
          result += '\n\n[Content truncated — increase max_length or visit the URL directly]'
        }

        return {
          content: [{ type: 'text' as const, text: result }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Error fetching ${p.url}: ${message}` }],
          details: undefined
        }
      }
    }
  }
}
