import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { parseHTML } from 'linkedom'
import TurndownService from 'turndown'

const DEFAULT_MAX_LENGTH = 50_000
const MAX_REDIRECTS = 5

const JUNK_SELECTORS = [
  'script',
  'style',
  'nav',
  'footer',
  'header',
  'aside',
  'iframe',
  'noscript',
  'svg',
  'form',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '.nav',
  '.navbar',
  '.footer',
  '.sidebar',
  '.menu',
  '.ad',
  '.ads',
  '.advertisement'
]

// SSRF guard: this fetch runs in the Electron main process, outside the bash
// sandbox's domain restrictions, so we must block internal targets ourselves.

const BLOCKED_IPV4_RANGES: Array<[base: string, prefixBits: number]> = [
  ['0.0.0.0', 8], // "this host" — routes to localhost on most stacks
  ['10.0.0.0', 8], // private
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local incl. cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.168.0.0', 16] // private
]

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const v = Number(part)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

// Expands an IPv6 literal (already validated by net.isIP) into 8 16-bit groups.
function expandIpv6(ip: string): number[] | null {
  let s = ip
  // Rewrite an embedded IPv4 tail (e.g. ::ffff:127.0.0.1) as two hex groups
  if (s.includes('.')) {
    const lastColon = s.lastIndexOf(':')
    const v4 = ipv4ToInt(s.slice(lastColon + 1))
    if (v4 === null) return null
    s = `${s.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  let groups: string[]
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length
    if (fill < 0) return null
    groups = [...head, ...Array(fill).fill('0'), ...tail]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  const nums = groups.map((g) => parseInt(g, 16))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null
  return nums
}

export function isBlockedIp(ip: string): boolean {
  const bare = ip.replace(/%.*$/, '') // strip IPv6 zone id
  const version = isIP(bare)
  if (version === 4) {
    const n = ipv4ToInt(bare)
    if (n === null) return true
    return BLOCKED_IPV4_RANGES.some(([base, prefixBits]) => {
      const mask = (~0 << (32 - prefixBits)) >>> 0
      return (n & mask) >>> 0 === (ipv4ToInt(base)! & mask) >>> 0
    })
  }
  if (version === 6) {
    const groups = expandIpv6(bare)
    if (!groups) return true
    // IPv4-mapped (::ffff:a.b.c.d) — apply the IPv4 rules to the embedded address
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      const v4 = `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`
      return isBlockedIp(v4)
    }
    if (groups.every((g) => g === 0)) return true // :: unspecified
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true // ::1 loopback
    if ((groups[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
    if ((groups[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
    return false
  }
  // Not a valid IP literal — fail closed for callers passing resolved addresses
  return true
}

export type UrlValidation = { ok: true; url: URL } | { ok: false; error: string }

export function validateFetchUrl(raw: string, base?: URL): UrlValidation {
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return { ok: false, error: `Error: invalid URL: ${raw}` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      error: `Error: blocked URL scheme "${url.protocol}" — only http: and https: are allowed.`
    }
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && isBlockedIp(host)) {
    return {
      ok: false,
      error: `Error: blocked URL ${url.href} — it targets a loopback, private, or link-local address.`
    }
  }
  return { ok: true, url }
}

// Resolves the hostname and returns a blocked address if any resolved IP is
// internal (loopback/private/link-local/metadata), otherwise null.
async function findBlockedAddress(url: URL): Promise<string | null> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    return isBlockedIp(host) ? host : null
  }
  const results = await lookup(host, { all: true })
  for (const { address } of results) {
    if (isBlockedIp(address)) return address
  }
  return null
}

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], details: undefined }
}

export function createWebFetchTool(): ToolDefinition {
  return {
    name: 'web_fetch',
    label: 'Web Fetch',
    description:
      'Fetch a web page and extract its content as Markdown. Use this to read documentation, articles, blog posts, or any text-heavy web page. Best used after web_search to read specific URLs from search results.',
    parameters: Type.Object({
      url: Type.String({ description: 'The URL to fetch' }),
      max_length: Type.Optional(
        Type.Number({
          description:
            'Maximum character length of returned content (default: 50000). Reduce for shorter pages to save context.',
          minimum: 1000,
          maximum: 100_000
        })
      )
    }),
    async execute(_toolCallId, params) {
      const p = params as { url: string; max_length?: number }
      const maxLength = p.max_length ?? DEFAULT_MAX_LENGTH

      const initial = validateFetchUrl(p.url)
      if (!initial.ok) {
        return errorResult(initial.error)
      }
      let url = initial.url

      try {
        let response: Response | undefined
        // Follow redirects manually so every hop is re-validated against the
        // SSRF rules (fetch's automatic redirect would bypass them).
        for (let hop = 0; ; hop++) {
          const blockedAddress = await findBlockedAddress(url)
          if (blockedAddress) {
            return errorResult(
              `Error: blocked URL ${url.href} — its host resolves to ${blockedAddress}, a loopback, private, or link-local address.`
            )
          }

          response = await fetch(url.href, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            redirect: 'manual',
            signal: AbortSignal.timeout(15_000)
          })

          if (response.status < 300 || response.status >= 400) break
          const location = response.headers.get('location')
          if (!location) break
          if (hop >= MAX_REDIRECTS) {
            return errorResult(
              `Error: too many redirects (more than ${MAX_REDIRECTS}) fetching ${p.url}`
            )
          }
          const next = validateFetchUrl(location, url)
          if (!next.ok) {
            return errorResult(`Error: blocked redirect from ${url.href}. ${next.error}`)
          }
          await response.body?.cancel().catch(() => {})
          url = next.url
        }

        if (!response || !response.ok) {
          return errorResult(
            `Error: HTTP ${response?.status} ${response?.statusText} fetching ${p.url}`
          )
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
          return errorResult(
            `Error: URL returned non-HTML content (${contentType}). This tool only works with HTML pages.`
          )
        }

        const html = await response.text()
        const { document } = parseHTML(html)

        // Strip junk elements
        for (const selector of JUNK_SELECTORS) {
          for (const el of document.querySelectorAll(selector)) {
            el.remove()
          }
        }

        // Get the main content area, or fall back to body
        const main =
          document.querySelector('main') ??
          document.querySelector('article') ??
          document.querySelector('[role="main"]') ??
          document.body

        if (!main || !main.innerHTML.trim()) {
          return errorResult('Error: No readable content found on the page.')
        }

        const turndown = new TurndownService({
          headingStyle: 'atx',
          codeBlockStyle: 'fenced',
          bulletListMarker: '-'
        })

        let markdown = turndown.turndown(main.innerHTML)

        // Clean up excessive blank lines
        markdown = markdown.replace(/\n{3,}/g, '\n\n').trim()

        let truncated = false
        if (markdown.length > maxLength) {
          markdown = markdown.slice(0, maxLength)
          truncated = true
        }

        const title = document.querySelector('title')?.textContent?.trim()
        let result = ''
        if (title) {
          result += `# ${title}\n\n`
        }
        result += `Source: ${p.url}\n\n`
        result += markdown
        if (truncated) {
          result += '\n\n[Content truncated — increase max_length or visit the URL directly]'
        }

        return {
          content: [{ type: 'text' as const, text: result }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return errorResult(`Error fetching ${p.url}: ${message}`)
      }
    }
  }
}
