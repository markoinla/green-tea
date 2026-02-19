import { getValidMicrosoftAccessToken } from './auth'

export async function microsoftFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = await getValidMicrosoftAccessToken()
  if (!token) {
    throw new Error(
      'Not authenticated with Microsoft. Please connect your Microsoft account first.'
    )
  }

  const headers = new Headers(options?.headers)
  headers.set('Authorization', `Bearer ${token}`)

  return fetch(url, {
    ...options,
    headers
  })
}
