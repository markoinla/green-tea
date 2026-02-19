import { describe, it, expect } from 'vitest'

const PROXY_URL = 'https://greentea-proxy.m-6bb.workers.dev/v1'

describe('proxy server integration', () => {
  describe('chat completions', () => {
    it('returns valid response for green-tea model', async () => {
      const res = await fetch(`${PROXY_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer proxy'
        },
        body: JSON.stringify({
          model: 'green-tea',
          messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
          max_tokens: 50
        })
      })

      expect(res.ok).toBe(true)
      const data = await res.json()
      expect(data.choices).toBeDefined()
      expect(data.choices.length).toBeGreaterThanOrEqual(1)
      expect(data.choices[0].message).toBeDefined()
      expect(typeof data.choices[0].message.content).toBe('string')
    }, 30000)

    it('returns SSE stream with stream: true', async () => {
      const res = await fetch(`${PROXY_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer proxy'
        },
        body: JSON.stringify({
          model: 'green-tea',
          messages: [{ role: 'user', content: 'Say "hi".' }],
          max_tokens: 20,
          stream: true
        })
      })

      expect(res.ok).toBe(true)
      const contentType = res.headers.get('content-type')
      expect(contentType).toContain('text/event-stream')

      const text = await res.text()
      expect(text).toContain('data:')
    }, 30000)

    it('returns valid response for green-tea-fast model', async () => {
      const res = await fetch(`${PROXY_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer proxy'
        },
        body: JSON.stringify({
          model: 'green-tea-fast',
          messages: [{ role: 'user', content: 'Say "ok".' }],
          max_tokens: 20
        })
      })

      expect(res.ok).toBe(true)
      const data = await res.json()
      expect(data.choices).toBeDefined()
      expect(data.choices[0].message).toBeDefined()
    }, 30000)
  })

  describe('web search', () => {
    it('returns search results', async () => {
      const res = await fetch(`${PROXY_URL}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer proxy'
        },
        body: JSON.stringify({
          query: 'test',
          max_results: 3
        })
      })

      expect(res.ok).toBe(true)
      const data = await res.json()
      expect(data.results).toBeDefined()
      expect(Array.isArray(data.results)).toBe(true)
      if (data.results.length > 0) {
        expect(data.results[0].title).toBeDefined()
        expect(data.results[0].url).toBeDefined()
        expect(data.results[0].content).toBeDefined()
      }
    }, 30000)
  })

  describe('error handling', () => {
    it('returns error for invalid model', async () => {
      const res = await fetch(`${PROXY_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer proxy'
        },
        body: JSON.stringify({
          model: 'nonexistent-model-12345',
          messages: [{ role: 'user', content: 'test' }]
        })
      })

      // Proxy should return an error (may be 400 or 500 depending on implementation)
      const data = await res.json()
      expect(data.error || !res.ok).toBeTruthy()
    }, 30000)

    it('accepts requests without explicit auth header', async () => {
      const res = await fetch(`${PROXY_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'green-tea',
          messages: [{ role: 'user', content: 'Say "ok".' }],
          max_tokens: 10
        })
      })

      expect(res.ok).toBe(true)
    }, 30000)
  })
})
