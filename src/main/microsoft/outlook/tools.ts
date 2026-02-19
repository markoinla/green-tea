import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { hasMicrosoftAuth } from '../auth'
import { searchMessages, getMessage } from './api'
import type { OutlookMessage } from '../types'

function formatMessage(msg: OutlookMessage, includeBody: boolean): string {
  const lines: string[] = []
  lines.push(`ID: ${msg.id}`)
  lines.push(`Subject: ${msg.subject || '(no subject)'}`)
  if (msg.from?.emailAddress) {
    const from = msg.from.emailAddress
    lines.push(`From: ${from.name ? `${from.name} <${from.address}>` : from.address}`)
  }
  if (msg.toRecipients?.length) {
    const to = msg.toRecipients
      .map((r) =>
        r.emailAddress.name
          ? `${r.emailAddress.name} <${r.emailAddress.address}>`
          : r.emailAddress.address
      )
      .join(', ')
    lines.push(`To: ${to}`)
  }
  if (includeBody && msg.ccRecipients?.length) {
    const cc = msg.ccRecipients
      .map((r) =>
        r.emailAddress.name
          ? `${r.emailAddress.name} <${r.emailAddress.address}>`
          : r.emailAddress.address
      )
      .join(', ')
    lines.push(`CC: ${cc}`)
  }
  lines.push(`Date: ${msg.receivedDateTime}`)

  if (!includeBody && msg.bodyPreview) {
    lines.push(`Snippet: ${msg.bodyPreview}`)
  }

  if (includeBody) {
    lines.push(`Read: ${msg.isRead ? 'Yes' : 'No'}`)
    const body = msg.body?.content || ''
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
        text: 'Microsoft account is not connected with Outlook access. Please ask the user to connect Microsoft Outlook in Settings.'
      }
    ],
    details: undefined
  }
}

export function createOutlookTools(): ToolDefinition[] {
  const searchTool: ToolDefinition = {
    name: 'microsoft_outlook_search',
    label: 'Search Outlook',
    description:
      "Search the user's Microsoft Outlook email using keywords (supports from:, to:, subject:, body: syntax). Returns message metadata.",
    parameters: Type.Object({
      query: Type.String({
        description:
          'Search query (supports KQL syntax: from:, to:, subject:, body:, received:, etc.)'
      }),
      max_results: Type.Optional(
        Type.Number({
          description: 'Maximum number of messages to return (default: 10, max: 25)',
          minimum: 1,
          maximum: 25
        })
      )
    }),
    async execute(_toolCallId, params) {
      if (!hasMicrosoftAuth()) return notConnectedResult()

      const p = params as { query: string; max_results?: number }
      const maxResults = Math.min(p.max_results ?? 10, 25)

      try {
        const messages = await searchMessages({ query: p.query, maxResults })

        if (messages.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No messages found matching "${p.query}".` }],
            details: undefined
          }
        }

        const formatted = messages.map((m) => formatMessage(m, false)).join('\n\n---\n\n')
        const text = `Found ${messages.length} message${messages.length === 1 ? '' : 's'} matching "${p.query}":\n\n${formatted}`

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Outlook error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  const getMessageTool: ToolDefinition = {
    name: 'microsoft_outlook_get_message',
    label: 'Get Outlook Message',
    description:
      'Get the full content of a specific Outlook message by its ID, including the message body.',
    parameters: Type.Object({
      message_id: Type.String({ description: 'The Outlook message ID to retrieve' })
    }),
    async execute(_toolCallId, params) {
      if (!hasMicrosoftAuth()) return notConnectedResult()

      const p = params as { message_id: string }

      try {
        const msg = await getMessage(p.message_id)
        const text = formatMessage(msg, true)

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Outlook error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  return [searchTool, getMessageTool]
}
