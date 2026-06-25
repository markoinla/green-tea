import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export interface ParsedFrontmatter {
  data: Record<string, unknown>
  body: string
}

// Matches a leading YAML frontmatter block delimited by --- fences, plus any
// blank lines that follow the closing fence (so the body never starts blank).
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n+/

/**
 * Split a raw note file into its YAML frontmatter object and the markdown body.
 * Malformed or absent frontmatter yields an empty object and the original text
 * as the body (never throws, never loses content).
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return { data: {}, body: raw }

  let data: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(match[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  } catch {
    // Malformed YAML — treat the whole file as body so nothing is lost.
    return { data: {}, body: raw }
  }

  return { data, body: raw.slice(match[0].length) }
}

/**
 * Re-join a frontmatter object and a markdown body into a note file. An empty
 * object produces no fence at all. Output is normalized so that
 * parse → stringify is a stable fixed point.
 */
export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const keys = Object.keys(data)
  if (keys.length === 0) return body

  const yaml = stringifyYaml(data).replace(/\r?\n$/, '')
  const normalizedBody = body.replace(/^\r?\n+/, '')
  return `---\n${yaml}\n---\n\n${normalizedBody}`
}
