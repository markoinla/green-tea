import { getValidAccessToken } from './auth'

export async function googleFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = await getValidAccessToken()
  if (!token) {
    throw new Error('Not authenticated with Google. Please connect your Google account first.')
  }

  const headers = new Headers(options?.headers)
  headers.set('Authorization', `Bearer ${token}`)

  return fetch(url, {
    ...options,
    headers
  })
}
