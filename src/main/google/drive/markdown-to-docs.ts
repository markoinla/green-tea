/**
 * Converts markdown content into Google Docs API batchUpdate requests.
 * Parses headings, bold, italic, code, links, and lists, then produces
 * insertText + updateTextStyle + updateParagraphStyle requests.
 */

type DocsRequest = Record<string, unknown>

interface TextSegment {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  link?: string
}

interface ParsedLine {
  segments: TextSegment[]
  headingLevel?: number // 1-6
  listType?: 'bullet' | 'ordered'
}

/** Parse inline markdown (bold, italic, code, links) within a line of text */
function parseInline(text: string): TextSegment[] {
  const segments: TextSegment[] = []

  // Regex matches: links, bold+italic, bold, italic, inline code
  const inlineRegex =
    /\[([^\]]+)\]\(([^)]+)\)|\*\*\*(.+?)\*\*\*|___(.+?)___|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`([^`]+)`/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlineRegex.exec(text)) !== null) {
    // Push any text before this match
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) })
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Link: [text](url)
      segments.push({ text: match[1], link: match[2] })
    } else if (match[3] !== undefined || match[4] !== undefined) {
      // Bold+italic: ***text*** or ___text___
      segments.push({ text: match[3] || match[4], bold: true, italic: true })
    } else if (match[5] !== undefined || match[6] !== undefined) {
      // Bold: **text** or __text__
      segments.push({ text: match[5] || match[6], bold: true })
    } else if (match[7] !== undefined || match[8] !== undefined) {
      // Italic: *text* or _text_
      segments.push({ text: match[7] || match[8], italic: true })
    } else if (match[9] !== undefined) {
      // Inline code: `text`
      segments.push({ text: match[9], code: true })
    }

    lastIndex = match.index + match[0].length
  }

  // Push remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) })
  }

  // If nothing was parsed, return the whole text as one segment
  if (segments.length === 0) {
    segments.push({ text })
  }

  return segments
}

/** Parse markdown content into structured lines */
function parseMarkdown(markdown: string): ParsedLine[] {
  const lines = markdown.split('\n')
  const parsed: ParsedLine[] = []

  for (const line of lines) {
    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      parsed.push({
        segments: parseInline(headingMatch[2]),
        headingLevel: headingMatch[1].length
      })
      continue
    }

    // Unordered list items (-, *, +)
    const bulletMatch = line.match(/^[\s]*[-*+]\s+(.+)$/)
    if (bulletMatch) {
      parsed.push({
        segments: parseInline(bulletMatch[1]),
        listType: 'bullet'
      })
      continue
    }

    // Ordered list items (1., 2., etc.)
    const orderedMatch = line.match(/^[\s]*\d+\.\s+(.+)$/)
    if (orderedMatch) {
      parsed.push({
        segments: parseInline(orderedMatch[1]),
        listType: 'ordered'
      })
      continue
    }

    // Regular line (could be empty)
    parsed.push({
      segments: parseInline(line)
    })
  }

  return parsed
}

/** Map heading level to Google Docs named style */
function headingStyle(level: number): string {
  const map: Record<number, string> = {
    1: 'HEADING_1',
    2: 'HEADING_2',
    3: 'HEADING_3',
    4: 'HEADING_4',
    5: 'HEADING_5',
    6: 'HEADING_6'
  }
  return map[level] || 'NORMAL_TEXT'
}

/**
 * Convert markdown content to Google Docs API batchUpdate requests.
 * Returns an array of request objects ready for the batchUpdate endpoint.
 */
export function markdownToDocsRequests(markdown: string): DocsRequest[] {
  const parsed = parseMarkdown(markdown)

  // First pass: build the full plain text and track ranges for formatting
  let fullText = ''
  const lineRanges: { start: number; end: number; line: ParsedLine }[] = []
  const segmentRanges: {
    start: number
    end: number
    segment: TextSegment
  }[] = []

  for (const line of parsed) {
    const lineStart = fullText.length
    for (const segment of line.segments) {
      const segStart = fullText.length
      fullText += segment.text
      segmentRanges.push({ start: segStart, end: fullText.length, segment })
    }
    const lineEnd = fullText.length
    fullText += '\n'
    lineRanges.push({ start: lineStart, end: lineEnd + 1, line })
  }

  // Remove trailing newline if present
  if (fullText.endsWith('\n') && fullText.length > 1) {
    fullText = fullText.slice(0, -1)
  }

  if (!fullText.trim()) return []

  const requests: DocsRequest[] = []

  // All indices in Google Docs API are 1-based (index 1 = start of document body)
  const baseIndex = 1

  // Insert all text at once
  requests.push({
    insertText: {
      location: { index: baseIndex },
      text: fullText
    }
  })

  // Apply paragraph styles (headings) — must go in reverse order to keep indices valid
  for (let i = lineRanges.length - 1; i >= 0; i--) {
    const { start, end, line } = lineRanges[i]
    if (line.headingLevel) {
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: baseIndex + start,
            endIndex: baseIndex + end
          },
          paragraphStyle: {
            namedStyleType: headingStyle(line.headingLevel)
          },
          fields: 'namedStyleType'
        }
      })
    }

    if (line.listType) {
      // Use bullet preset for lists
      requests.push({
        createParagraphBullets: {
          range: {
            startIndex: baseIndex + start,
            endIndex: baseIndex + end
          },
          bulletPreset:
            line.listType === 'ordered'
              ? 'NUMBERED_DECIMAL_ALPHA_ROMAN'
              : 'BULLET_DISC_CIRCLE_SQUARE'
        }
      })
    }
  }

  // Apply text styles (bold, italic, code, links)
  for (const { start, end, segment } of segmentRanges) {
    if (start === end) continue

    const textStyle: Record<string, unknown> = {}
    const fields: string[] = []

    if (segment.bold) {
      textStyle.bold = true
      fields.push('bold')
    }
    if (segment.italic) {
      textStyle.italic = true
      fields.push('italic')
    }
    if (segment.code) {
      textStyle.weightedFontFamily = { fontFamily: 'Courier New' }
      textStyle.backgroundColor = {
        color: { rgbColor: { red: 0.95, green: 0.95, blue: 0.95 } }
      }
      fields.push('weightedFontFamily', 'backgroundColor')
    }
    if (segment.link) {
      textStyle.link = { url: segment.link }
      fields.push('link')
    }

    if (fields.length > 0) {
      requests.push({
        updateTextStyle: {
          range: {
            startIndex: baseIndex + start,
            endIndex: baseIndex + end
          },
          textStyle,
          fields: fields.join(',')
        }
      })
    }
  }

  return requests
}
