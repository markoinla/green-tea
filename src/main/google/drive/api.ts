import { googleFetch } from '../client'
import type { DriveFile, DriveFileListResponse } from '../types'
import { markdownToDocsRequests } from './markdown-to-docs'

const DRIVE_BASE_URL = 'https://www.googleapis.com/drive/v3'
const DOCS_BASE_URL = 'https://docs.googleapis.com/v1'
const SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4'
const SLIDES_BASE_URL = 'https://slides.googleapis.com/v1'

export async function searchFiles(options: {
  query: string
  maxResults?: number
}): Promise<DriveFile[]> {
  const params = new URLSearchParams()
  params.set('q', options.query)
  params.set('pageSize', String(options.maxResults ?? 10))
  params.set('fields', 'files(id,name,mimeType,modifiedTime,webViewLink,owners)')

  const res = await googleFetch(`${DRIVE_BASE_URL}/files?${params.toString()}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Drive API error (${res.status}): ${text}`)
  }
  const data = (await res.json()) as DriveFileListResponse
  return data.files || []
}

export async function createDocument(options: {
  title: string
  content?: string
}): Promise<{ id: string; documentId: string; title: string; webViewLink: string }> {
  // Create the document
  const createRes = await googleFetch(`${DOCS_BASE_URL}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: options.title })
  })

  if (!createRes.ok) {
    const text = await createRes.text()
    throw new Error(`Docs API error (${createRes.status}): ${text}`)
  }

  const doc = (await createRes.json()) as {
    documentId: string
    title: string
  }

  // Insert content if provided — convert markdown to native Google Docs formatting
  if (options.content) {
    const requests = markdownToDocsRequests(options.content)
    if (requests.length > 0) {
      const updateRes = await googleFetch(
        `${DOCS_BASE_URL}/documents/${doc.documentId}:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests })
        }
      )

      if (!updateRes.ok) {
        const text = await updateRes.text()
        throw new Error(`Docs API batchUpdate error (${updateRes.status}): ${text}`)
      }
    }
  }

  return {
    id: doc.documentId,
    documentId: doc.documentId,
    title: doc.title,
    webViewLink: `https://docs.google.com/document/d/${doc.documentId}/edit`
  }
}

export async function createSpreadsheet(options: {
  title: string
  sheetData?: string[][]
}): Promise<{ id: string; spreadsheetId: string; title: string; webViewLink: string }> {
  const body: Record<string, unknown> = {
    properties: { title: options.title }
  }

  if (options.sheetData && options.sheetData.length > 0) {
    body.sheets = [
      {
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: options.sheetData.map((row) => ({
              values: row.map((cell) => ({
                userEnteredValue: { stringValue: cell }
              }))
            }))
          }
        ]
      }
    ]
  }

  const res = await googleFetch(`${SHEETS_BASE_URL}/spreadsheets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Sheets API error (${res.status}): ${text}`)
  }

  const sheet = (await res.json()) as {
    spreadsheetId: string
    properties: { title: string }
    spreadsheetUrl: string
  }

  return {
    id: sheet.spreadsheetId,
    spreadsheetId: sheet.spreadsheetId,
    title: sheet.properties.title,
    webViewLink: sheet.spreadsheetUrl
  }
}

interface DocParagraphElement {
  textRun?: { content: string }
}

interface DocStructuralElement {
  paragraph?: { elements?: DocParagraphElement[] }
  table?: {
    tableRows?: {
      tableCells?: {
        content?: DocStructuralElement[]
      }[]
    }[]
  }
}

function extractDocText(elements: DocStructuralElement[]): string {
  const parts: string[] = []
  for (const el of elements) {
    if (el.paragraph?.elements) {
      for (const pe of el.paragraph.elements) {
        if (pe.textRun?.content) parts.push(pe.textRun.content)
      }
    }
    if (el.table?.tableRows) {
      for (const row of el.table.tableRows) {
        if (row.tableCells) {
          const cells = row.tableCells.map((cell) =>
            cell.content ? extractDocText(cell.content).trim() : ''
          )
          parts.push(cells.join('\t') + '\n')
        }
      }
    }
  }
  return parts.join('')
}

export async function getDocument(documentId: string): Promise<{
  title: string
  body: string
  webViewLink: string
}> {
  const res = await googleFetch(`${DOCS_BASE_URL}/documents/${encodeURIComponent(documentId)}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Docs API error (${res.status}): ${text}`)
  }

  const doc = (await res.json()) as {
    documentId: string
    title: string
    body?: { content?: DocStructuralElement[] }
  }

  const body = doc.body?.content ? extractDocText(doc.body.content) : ''

  return {
    title: doc.title,
    body,
    webViewLink: `https://docs.google.com/document/d/${doc.documentId}/edit`
  }
}

interface SheetData {
  properties: { title: string }
  data?: {
    rowData?: {
      values?: { formattedValue?: string }[]
    }[]
  }[]
}

export async function getSpreadsheet(spreadsheetId: string): Promise<{
  title: string
  sheets: { name: string; rows: string[][] }[]
  webViewLink: string
}> {
  const params = new URLSearchParams()
  params.set('includeGridData', 'true')

  const res = await googleFetch(
    `${SHEETS_BASE_URL}/spreadsheets/${encodeURIComponent(spreadsheetId)}?${params.toString()}`
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Sheets API error (${res.status}): ${text}`)
  }

  const data = (await res.json()) as {
    spreadsheetId: string
    properties: { title: string }
    spreadsheetUrl: string
    sheets?: SheetData[]
  }

  const sheets = (data.sheets || []).map((sheet) => {
    const rows: string[][] = []
    const gridData = sheet.data?.[0]
    if (gridData?.rowData) {
      for (const row of gridData.rowData) {
        const cells = (row.values || []).map((v) => v.formattedValue || '')
        rows.push(cells)
      }
    }
    return { name: sheet.properties.title, rows }
  })

  return {
    title: data.properties.title,
    sheets,
    webViewLink: data.spreadsheetUrl
  }
}

// --- Slides ---

interface SlideTextRun {
  content?: string
}

interface SlideTextElement {
  textRun?: SlideTextRun
}

interface SlidePageElement {
  objectId: string
  shape?: {
    shapeType?: string
    text?: { textElements?: SlideTextElement[] }
    placeholder?: { type?: string }
  }
  table?: {
    rows: number
    columns: number
    tableRows?: {
      tableCells?: {
        text?: { textElements?: SlideTextElement[] }
      }[]
    }[]
  }
}

interface SlidePage {
  objectId: string
  pageElements?: SlidePageElement[]
  slideProperties?: {
    layoutObjectId?: string
  }
}

function extractSlideText(textElements: SlideTextElement[]): string {
  return textElements
    .map((te) => te.textRun?.content || '')
    .join('')
    .trim()
}

function extractPageText(page: SlidePage): string {
  const parts: string[] = []
  for (const el of page.pageElements || []) {
    if (el.shape?.text?.textElements) {
      const text = extractSlideText(el.shape.text.textElements)
      if (text) parts.push(text)
    }
    if (el.table?.tableRows) {
      for (const row of el.table.tableRows) {
        const cells = (row.tableCells || []).map((cell) =>
          cell.text?.textElements ? extractSlideText(cell.text.textElements) : ''
        )
        const rowText = cells.join('\t').trim()
        if (rowText) parts.push(rowText)
      }
    }
  }
  return parts.join('\n')
}

export async function getPresentation(presentationId: string): Promise<{
  title: string
  slides: { index: number; text: string }[]
  webViewLink: string
}> {
  const res = await googleFetch(
    `${SLIDES_BASE_URL}/presentations/${encodeURIComponent(presentationId)}`
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Slides API error (${res.status}): ${text}`)
  }

  const pres = (await res.json()) as {
    presentationId: string
    title: string
    slides?: SlidePage[]
  }

  const slides = (pres.slides || []).map((slide, i) => ({
    index: i + 1,
    text: extractPageText(slide)
  }))

  return {
    title: pres.title,
    slides,
    webViewLink: `https://docs.google.com/presentation/d/${pres.presentationId}/edit`
  }
}

export async function createPresentation(options: {
  title: string
  slides?: { title?: string; body?: string }[]
}): Promise<{ id: string; presentationId: string; title: string; webViewLink: string }> {
  // Create the presentation
  const createRes = await googleFetch(`${SLIDES_BASE_URL}/presentations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: options.title })
  })

  if (!createRes.ok) {
    const text = await createRes.text()
    throw new Error(`Slides API error (${createRes.status}): ${text}`)
  }

  const pres = (await createRes.json()) as {
    presentationId: string
    title: string
  }

  // Add slides with content if provided
  if (options.slides && options.slides.length > 0) {
    const requests: Record<string, unknown>[] = []

    for (let i = 0; i < options.slides.length; i++) {
      const slide = options.slides[i]
      const slideId = `slide_${i}`
      const titleId = `slide_${i}_title`
      const bodyId = `slide_${i}_body`

      requests.push({
        createSlide: {
          objectId: slideId,
          insertionIndex: i + 1,
          slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
          placeholderIdMappings: [
            { layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: titleId },
            { layoutPlaceholder: { type: 'BODY', index: 0 }, objectId: bodyId }
          ]
        }
      })

      if (slide.title) {
        requests.push({
          insertText: { objectId: titleId, text: slide.title }
        })
      }

      if (slide.body) {
        requests.push({
          insertText: { objectId: bodyId, text: slide.body }
        })
      }
    }

    const updateRes = await googleFetch(
      `${SLIDES_BASE_URL}/presentations/${pres.presentationId}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      }
    )

    if (!updateRes.ok) {
      const text = await updateRes.text()
      throw new Error(`Slides API batchUpdate error (${updateRes.status}): ${text}`)
    }
  }

  return {
    id: pres.presentationId,
    presentationId: pres.presentationId,
    title: pres.title,
    webViewLink: `https://docs.google.com/presentation/d/${pres.presentationId}/edit`
  }
}
