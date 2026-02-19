import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { hasGoogleAuth } from '../auth'
import { listEvents, getEvent } from './api'
import type { CalendarEvent } from '../types'

function formatEventTime(event: CalendarEvent): string {
  const startDt = event.start.dateTime
  const endDt = event.end.dateTime
  const startDate = event.start.date
  const endDate = event.end.date

  if (startDt && endDt) {
    const start = new Date(startDt)
    const end = new Date(endDt)
    const dateStr = start.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
    const startTime = start.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    })
    const endTime = end.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    })
    return `${dateStr}, ${startTime} - ${endTime}`
  }

  if (startDate) {
    const start = new Date(startDate + 'T00:00:00')
    const dateStr = start.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
    if (endDate && endDate !== startDate) {
      const end = new Date(endDate + 'T00:00:00')
      const endStr = end.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
      return `${dateStr} - ${endStr} (all day)`
    }
    return `${dateStr} (all day)`
  }

  return 'Time not specified'
}

function formatEvent(event: CalendarEvent): string {
  const lines: string[] = []
  lines.push(`Title: ${event.summary}`)
  lines.push(`When: ${formatEventTime(event)}`)

  if (event.location) {
    lines.push(`Location: ${event.location}`)
  }

  if (event.description) {
    const desc =
      event.description.length > 200 ? event.description.slice(0, 200) + '...' : event.description
    lines.push(`Description: ${desc}`)
  }

  if (event.attendees && event.attendees.length > 0) {
    const attendeeList = event.attendees
      .map((a) => {
        const name = a.displayName || a.email
        return a.responseStatus ? `${name} (${a.responseStatus})` : name
      })
      .join(', ')
    lines.push(`Attendees: ${attendeeList}`)
  }

  if (event.htmlLink) {
    lines.push(`Link: ${event.htmlLink}`)
  }

  return lines.join('\n')
}

function notConnectedResult(): { content: { type: 'text'; text: string }[]; details: undefined } {
  return {
    content: [
      {
        type: 'text' as const,
        text: 'Google account is not connected. Please ask the user to connect their Google account in Settings before using calendar tools.'
      }
    ],
    details: undefined
  }
}

export function createCalendarTools(): ToolDefinition[] {
  const listEventsTool: ToolDefinition = {
    name: 'google_calendar_list_events',
    label: 'List Calendar Events',
    description:
      "List upcoming events from the user's Google Calendar. Returns events for the specified number of days ahead.",
    parameters: Type.Object({
      days_ahead: Type.Optional(
        Type.Number({
          description: 'Number of days ahead to look for events (default: 7)',
          minimum: 1,
          maximum: 90
        })
      ),
      max_results: Type.Optional(
        Type.Number({
          description: 'Maximum number of events to return (default: 10)',
          minimum: 1,
          maximum: 50
        })
      ),
      search_query: Type.Optional(
        Type.String({
          description: 'Optional text to search for in event titles and descriptions'
        })
      )
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { days_ahead?: number; max_results?: number; search_query?: string }
      const daysAhead = p.days_ahead ?? 7
      const maxResults = p.max_results ?? 10

      try {
        const now = new Date()
        const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)

        const events = await listEvents({
          timeMin: now.toISOString(),
          timeMax: future.toISOString(),
          maxResults,
          q: p.search_query
        })

        if (events.length === 0) {
          const text = p.search_query
            ? `No events found matching "${p.search_query}" in the next ${daysAhead} days.`
            : `No upcoming events found in the next ${daysAhead} days.`
          return {
            content: [{ type: 'text' as const, text }],
            details: undefined
          }
        }

        const formatted = events.map((e) => formatEvent(e)).join('\n\n---\n\n')
        const text = `Found ${events.length} event${events.length === 1 ? '' : 's'} in the next ${daysAhead} days:\n\n${formatted}`

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Calendar error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  const getEventTool: ToolDefinition = {
    name: 'google_calendar_get_event',
    label: 'Get Calendar Event',
    description: 'Get detailed information about a specific Google Calendar event by its ID.',
    parameters: Type.Object({
      event_id: Type.String({ description: 'The ID of the calendar event to retrieve' })
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { event_id: string }

      try {
        const event = await getEvent(p.event_id)
        const text = formatEvent(event)

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Calendar error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  const searchEventsTool: ToolDefinition = {
    name: 'google_calendar_search_events',
    label: 'Search Calendar Events',
    description:
      'Search for Google Calendar events matching a text query within a specified time range.',
    parameters: Type.Object({
      query: Type.String({ description: 'Text to search for in event titles and descriptions' }),
      days_ahead: Type.Optional(
        Type.Number({
          description: 'Number of days ahead to search (default: 30)',
          minimum: 1,
          maximum: 365
        })
      )
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { query: string; days_ahead?: number }
      const daysAhead = p.days_ahead ?? 30

      try {
        const now = new Date()
        const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)

        const events = await listEvents({
          timeMin: now.toISOString(),
          timeMax: future.toISOString(),
          maxResults: 20,
          q: p.query
        })

        if (events.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No events found matching "${p.query}" in the next ${daysAhead} days.`
              }
            ],
            details: undefined
          }
        }

        const formatted = events.map((e) => formatEvent(e)).join('\n\n---\n\n')
        const text = `Found ${events.length} event${events.length === 1 ? '' : 's'} matching "${p.query}":\n\n${formatted}`

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Calendar error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  return [listEventsTool, getEventTool, searchEventsTool]
}
