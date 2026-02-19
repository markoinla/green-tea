import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { hasGoogleAuth } from '../auth'
import { searchMessages, getMessage } from './api'
import type { GmailMessage, GmailMessageHeader, GmailMessagePart } from '../types'

function getHeader(headers: GmailMessageHeader[] | undefined, name: string): string {
  if (!headers) return ''
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

function extractTextBody(payload: GmailMessage['payload']): string {
  if (!payload) return ''

  // Direct text/plain body
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8')
  }

  // Search parts recursively
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractTextFromPart(part)
      if (text) return text
    }
  }

  return ''
}

function extractTextFromPart(part: GmailMessagePart): string {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf-8')
  }
  if (part.parts) {
    for (const sub of part.parts) {
      const text = extractTextFromPart(sub)
      if (text) return text
    }
  }
  return ''
}

function formatMessage(msg: GmailMessage, includeBody: boolean): string {
  const headers = msg.payload?.headers
  const lines: string[] = []
  lines.push(`ID: ${msg.id}`)
  lines.push(`Subject: ${getHeader(headers, 'Subject') || '(no subject)'}`)
  lines.push(`From: ${getHeader(headers, 'From')}`)
  lines.push(`To: ${getHeader(headers, 'To')}`)
  lines.push(`Date: ${getHeader(headers, 'Date')}`)

  if (msg.snippet) {
    lines.push(`Snippet: ${msg.snippet}`)
  }

  if (includeBody) {
    const body = extractTextBody(msg.payload)
    if (body) {
      const truncated = body.length > 1000 ? body.slice(0, 1000) + '...' : body
      lines.push(`\nBody:\n${truncated}`)
    }
  }

  return lines.join('\n')
}

function notConnectedResult(): { content: { type: 'text'; text: string }[]; details: undefined } {
  return {
    content: [
      {
        type: 'text' as const,
        text: 'Google account is not connected with Gmail access. Please ask the user to connect Gmail in Settings.'
      }
    ],
    details: undefined
  }
}

export function createGmailTools(): ToolDefinition[] {
  const searchTool: ToolDefinition = {
    name: 'google_gmail_search',
    label: 'Search Gmail',
    description:
      "Search the user's Gmail using Gmail query syntax (e.g. 'from:someone@example.com', 'subject:invoice', 'is:unread'). Returns message metadata.",
    parameters: Type.Object({
      query: Type.String({
        description:
          'Gmail search query (supports Gmail query syntax: from:, to:, subject:, is:, has:, etc.)'
      }),
      max_results: Type.Optional(
        Type.Number({
          description: 'Maximum number of messages to return (default: 10, max: 50)',
          minimum: 1,
          maximum: 50
        })
      )
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { query: string; max_results?: number }
      const maxResults = Math.min(p.max_results ?? 10, 50)

      try {
        const messageRefs = await searchMessages({ query: p.query, maxResults })

        if (messageRefs.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No messages found matching "${p.query}".` }],
            details: undefined
          }
        }

        // Fetch metadata for each message
        const messages = await Promise.all(messageRefs.map((ref) => getMessage(ref.id, 'metadata')))

        const formatted = messages.map((m) => formatMessage(m, false)).join('\n\n---\n\n')
        const text = `Found ${messages.length} message${messages.length === 1 ? '' : 's'} matching "${p.query}":\n\n${formatted}`

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Gmail error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  const getMessageTool: ToolDefinition = {
    name: 'google_gmail_get_message',
    label: 'Get Gmail Message',
    description:
      'Get the full content of a specific Gmail message by its ID, including decoded body text.',
    parameters: Type.Object({
      message_id: Type.String({ description: 'The Gmail message ID to retrieve' })
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { message_id: string }

      try {
        const msg = await getMessage(p.message_id, 'full')
        const text = formatMessage(msg, true)

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Gmail error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  return [searchTool, getMessageTool]
}
