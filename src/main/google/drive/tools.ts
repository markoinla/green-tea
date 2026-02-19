import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { hasGoogleAuth } from '../auth'
import {
  searchFiles,
  createDocument,
  createSpreadsheet,
  getDocument,
  getSpreadsheet,
  getPresentation,
  createPresentation
} from './api'
import type { DriveFile } from '../types'

const MIME_TYPE_LABELS: Record<string, string> = {
  'application/vnd.google-apps.document': 'Google Doc',
  'application/vnd.google-apps.spreadsheet': 'Google Sheet',
  'application/vnd.google-apps.presentation': 'Google Slides',
  'application/vnd.google-apps.folder': 'Folder',
  'application/vnd.google-apps.form': 'Google Form',
  'application/pdf': 'PDF',
  'image/png': 'PNG Image',
  'image/jpeg': 'JPEG Image',
  'text/plain': 'Text File',
  'text/csv': 'CSV File'
}

function formatMimeType(mimeType: string): string {
  return MIME_TYPE_LABELS[mimeType] || mimeType
}

function formatFile(file: DriveFile): string {
  const lines: string[] = []
  lines.push(`Name: ${file.name}`)
  lines.push(`Type: ${formatMimeType(file.mimeType)}`)
  lines.push(`ID: ${file.id}`)
  if (file.modifiedTime) {
    lines.push(`Modified: ${new Date(file.modifiedTime).toLocaleString()}`)
  }
  if (file.webViewLink) {
    lines.push(`Link: ${file.webViewLink}`)
  }
  if (file.owners && file.owners.length > 0) {
    lines.push(`Owner: ${file.owners.map((o) => o.displayName || o.emailAddress).join(', ')}`)
  }
  return lines.join('\n')
}

function notConnectedResult(): { content: { type: 'text'; text: string }[]; details: undefined } {
  return {
    content: [
      {
        type: 'text' as const,
        text: 'Google account is not connected with Drive access. Please ask the user to connect Google Drive in Settings.'
      }
    ],
    details: undefined
  }
}

export function createDriveTools(): ToolDefinition[] {
  const searchTool: ToolDefinition = {
    name: 'google_drive_search',
    label: 'Search Google Drive',
    description:
      "Search the user's Google Drive using Drive query syntax. Examples: name contains 'report', fullText contains 'budget', mimeType = 'application/vnd.google-apps.spreadsheet'.",
    parameters: Type.Object({
      query: Type.String({
        description:
          "Drive search query (supports: name contains 'x', fullText contains 'x', mimeType = '...', modifiedTime > '...', etc.)"
      }),
      max_results: Type.Optional(
        Type.Number({
          description: 'Maximum number of files to return (default: 10, max: 50)',
          minimum: 1,
          maximum: 50
        })
      )
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { query: string; max_results?: number }
      const maxResults = Math.min(p.max_results ?? 10, 50)

      try {
        const files = await searchFiles({ query: p.query, maxResults })

        if (files.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No files found matching the query.` }],
            details: undefined
          }
        }

        const formatted = files.map((f) => formatFile(f)).join('\n\n---\n\n')
        const text = `Found ${files.length} file${files.length === 1 ? '' : 's'}:\n\n${formatted}`

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Drive error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  const createDocTool: ToolDefinition = {
    name: 'google_drive_create_document',
    label: 'Create Google Doc',
    description: 'Create a new Google Docs document with a title and optional text content.',
    parameters: Type.Object({
      title: Type.String({ description: 'Title of the new document' }),
      content: Type.Optional(
        Type.String({ description: 'Optional text content to insert into the document' })
      )
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { title: string; content?: string }

      try {
        const doc = await createDocument({ title: p.title, content: p.content })
        const text = `Created Google Doc:\nTitle: ${doc.title}\nID: ${doc.documentId}\nLink: ${doc.webViewLink}`

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Drive error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  const createSheetTool: ToolDefinition = {
    name: 'google_drive_create_spreadsheet',
    label: 'Create Google Sheet',
    description: 'Create a new Google Sheets spreadsheet with a title and optional data rows.',
    parameters: Type.Object({
      title: Type.String({ description: 'Title of the new spreadsheet' }),
      data: Type.Optional(
        Type.Array(Type.Array(Type.String()), {
          description:
            'Optional 2D array of strings representing rows and columns. First row is typically headers.'
        })
      )
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { title: string; data?: string[][] }

      try {
        const sheet = await createSpreadsheet({ title: p.title, sheetData: p.data })
        const text = `Created Google Sheet:\nTitle: ${sheet.title}\nID: ${sheet.spreadsheetId}\nLink: ${sheet.webViewLink}`

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Drive error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  const getDocTool: ToolDefinition = {
    name: 'google_drive_get_document',
    label: 'Get Google Doc',
    description: 'Read the text content of an existing Google Docs document by its document ID.',
    parameters: Type.Object({
      document_id: Type.String({ description: 'The Google Docs document ID' })
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { document_id: string }

      try {
        const doc = await getDocument(p.document_id)
        const body =
          doc.body.length > 5000 ? doc.body.slice(0, 5000) + '\n\n...(truncated)' : doc.body
        const text = `Title: ${doc.title}\nLink: ${doc.webViewLink}\n\n${body}`

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Drive error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  const getSheetTool: ToolDefinition = {
    name: 'google_drive_get_spreadsheet',
    label: 'Get Google Sheet',
    description:
      'Read the content of an existing Google Sheets spreadsheet by its spreadsheet ID. Returns all sheets with their data as tab-separated rows.',
    parameters: Type.Object({
      spreadsheet_id: Type.String({ description: 'The Google Sheets spreadsheet ID' })
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { spreadsheet_id: string }

      try {
        const sheet = await getSpreadsheet(p.spreadsheet_id)
        const parts: string[] = []
        parts.push(`Title: ${sheet.title}`)
        parts.push(`Link: ${sheet.webViewLink}`)

        for (const s of sheet.sheets) {
          parts.push(`\n--- Sheet: ${s.name} ---`)
          const maxRows = 200
          const rows = s.rows.slice(0, maxRows)
          for (const row of rows) {
            parts.push(row.join('\t'))
          }
          if (s.rows.length > maxRows) {
            parts.push(`...(${s.rows.length - maxRows} more rows truncated)`)
          }
        }

        return {
          content: [{ type: 'text' as const, text: parts.join('\n') }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Drive error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  const getPresentationTool: ToolDefinition = {
    name: 'google_drive_get_presentation',
    label: 'Get Google Slides',
    description:
      'Read the text content of an existing Google Slides presentation by its presentation ID. Returns the text from each slide.',
    parameters: Type.Object({
      presentation_id: Type.String({ description: 'The Google Slides presentation ID' })
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { presentation_id: string }

      try {
        const pres = await getPresentation(p.presentation_id)
        const parts: string[] = []
        parts.push(`Title: ${pres.title}`)
        parts.push(`Link: ${pres.webViewLink}`)
        parts.push(`Slides: ${pres.slides.length}`)

        for (const slide of pres.slides) {
          parts.push(`\n--- Slide ${slide.index} ---`)
          parts.push(slide.text || '(empty)')
        }

        return {
          content: [{ type: 'text' as const, text: parts.join('\n') }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Drive error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  const createPresentationTool: ToolDefinition = {
    name: 'google_drive_create_presentation',
    label: 'Create Google Slides',
    description:
      'Create a new Google Slides presentation with a title and optional slides. Each slide can have a title and body text.',
    parameters: Type.Object({
      title: Type.String({ description: 'Title of the new presentation' }),
      slides: Type.Optional(
        Type.Array(
          Type.Object({
            title: Type.Optional(Type.String({ description: 'Slide title' })),
            body: Type.Optional(Type.String({ description: 'Slide body text' }))
          }),
          {
            description: 'Optional array of slides to add. Each slide has a title and body layout.'
          }
        )
      )
    }),
    async execute(_toolCallId, params) {
      if (!hasGoogleAuth()) return notConnectedResult()

      const p = params as { title: string; slides?: { title?: string; body?: string }[] }

      try {
        const pres = await createPresentation({ title: p.title, slides: p.slides })
        const slideCount = (p.slides?.length ?? 0) + 1 // +1 for default title slide
        const text = `Created Google Slides:\nTitle: ${pres.title}\nID: ${pres.presentationId}\nSlides: ${slideCount}\nLink: ${pres.webViewLink}`

        return {
          content: [{ type: 'text' as const, text }],
          details: undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: `Drive error: ${message}` }],
          details: undefined
        }
      }
    }
  }

  return [
    searchTool,
    createDocTool,
    createSheetTool,
    getDocTool,
    getSheetTool,
    getPresentationTool,
    createPresentationTool
  ]
}
