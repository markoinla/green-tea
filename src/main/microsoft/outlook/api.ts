import { microsoftFetch } from '../client'
import type { OutlookMessage, OutlookMessageListResponse } from '../types'

const BASE_URL = 'https://graph.microsoft.com/v1.0'

export async function searchMessages(options: {
  query: string
  maxResults?: number
}): Promise<OutlookMessage[]> {
  const maxResults = options.maxResults ?? 10
  const params = new URLSearchParams()
  params.set('$search', `"${options.query}"`)
  params.set('$top', String(maxResults))
  params.set(
    '$select',
    'id,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments'
  )

  const res = await microsoftFetch(`${BASE_URL}/me/messages?${params.toString()}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outlook API error (${res.status}): ${text}`)
  }
  const data = (await res.json()) as OutlookMessageListResponse
  return data.value || []
}

export async function getMessage(id: string): Promise<OutlookMessage> {
  const params = new URLSearchParams()
  params.set(
    '$select',
    'id,subject,body,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,webLink,importance,conversationId'
  )

  const res = await microsoftFetch(
    `${BASE_URL}/me/messages/${encodeURIComponent(id)}?${params.toString()}`,
    {
      headers: {
        Prefer: 'outlook.body-content-type="text"'
      }
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outlook API error (${res.status}): ${text}`)
  }
  return (await res.json()) as OutlookMessage
}
