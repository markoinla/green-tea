import { googleFetch } from '../client'
import type { CalendarEvent } from '../types'

const BASE_URL = 'https://www.googleapis.com/calendar/v3'

export async function listEvents(options: {
  calendarId?: string
  timeMin?: string
  timeMax?: string
  maxResults?: number
  q?: string
}): Promise<CalendarEvent[]> {
  const calendarId = options.calendarId || 'primary'
  const params = new URLSearchParams()
  if (options.timeMin) params.set('timeMin', options.timeMin)
  if (options.timeMax) params.set('timeMax', options.timeMax)
  if (options.maxResults) params.set('maxResults', String(options.maxResults))
  if (options.q) params.set('q', options.q)
  params.set('singleEvents', 'true')
  params.set('orderBy', 'startTime')

  const res = await googleFetch(
    `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Calendar API error (${res.status}): ${text}`)
  }
  const data = (await res.json()) as { items?: CalendarEvent[] }
  return data.items || []
}

export async function getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent> {
  const cal = calendarId || 'primary'
  const res = await googleFetch(
    `${BASE_URL}/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Calendar API error (${res.status}): ${text}`)
  }
  return (await res.json()) as CalendarEvent
}
