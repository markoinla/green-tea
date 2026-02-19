import { googleFetch } from '../client'
import type { GmailMessage, GmailMessageListResponse } from '../types'

const BASE_URL = 'https://gmail.googleapis.com/gmail/v1'

export async function searchMessages(options: {
  query: string
  maxResults?: number
}): Promise<{ id: string; threadId: string }[]> {
  const params = new URLSearchParams()
  params.set('q', options.query)
  params.set('maxResults', String(options.maxResults ?? 10))

  const res = await googleFetch(`${BASE_URL}/users/me/messages?${params.toString()}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail API error (${res.status}): ${text}`)
  }
  const data = (await res.json()) as GmailMessageListResponse
  return data.messages || []
}

export async function getMessage(
  id: string,
  format: 'metadata' | 'full' = 'full'
): Promise<GmailMessage> {
  const params = new URLSearchParams()
  params.set('format', format)
  if (format === 'metadata') {
    params.append('metadataHeaders', 'Subject')
    params.append('metadataHeaders', 'From')
    params.append('metadataHeaders', 'To')
    params.append('metadataHeaders', 'Date')
  }

  const res = await googleFetch(
    `${BASE_URL}/users/me/messages/${encodeURIComponent(id)}?${params.toString()}`
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail API error (${res.status}): ${text}`)
  }
  return (await res.json()) as GmailMessage
}
