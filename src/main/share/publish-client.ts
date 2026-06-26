import type { PublishRequest, PublishResponse } from '../../shared/share-contract'

/**
 * Thin HTTP client for the greentea-share worker. The worker contract:
 *   POST   {baseUrl}/publish   Authorization: Bearer <token>   body=PublishRequest -> 200 { slug, url }
 *   DELETE {baseUrl}/{slug}     Authorization: Bearer <token>                        -> 204 (404 if absent)
 * The token is never logged here. Re-publish is achieved by passing the
 * previously-stored slug in the request body (the worker overwrites in place,
 * keeping the public URL stable).
 */

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

async function errorText(res: Response): Promise<string> {
  try {
    const text = await res.text()
    if (!text) return ''
    try {
      const json = JSON.parse(text)
      if (json && typeof json === 'object' && typeof json.error === 'string') return json.error
    } catch {
      // not JSON — fall through to raw text
    }
    return text.slice(0, 200)
  } catch {
    return ''
  }
}

export async function publishToWorker(
  baseUrl: string,
  token: string,
  req: PublishRequest
): Promise<PublishResponse> {
  const res = await fetch(`${trimBaseUrl(baseUrl)}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(req)
  })

  if (!res.ok) {
    const detail = await errorText(res)
    throw new Error(`Share publish failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }

  const json = (await res.json()) as PublishResponse
  if (!json || typeof json.slug !== 'string' || typeof json.url !== 'string') {
    throw new Error('Share publish returned an unexpected response')
  }
  return json
}

export async function unpublishFromWorker(
  baseUrl: string,
  token: string,
  slug: string
): Promise<void> {
  const res = await fetch(`${trimBaseUrl(baseUrl)}/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  })

  // 204 = deleted, 404 = already absent — both are success for an unpublish.
  if (res.ok || res.status === 404) return

  const detail = await errorText(res)
  throw new Error(`Share unpublish failed (${res.status})${detail ? `: ${detail}` : ''}`)
}
