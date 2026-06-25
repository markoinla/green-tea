import type Database from 'better-sqlite3'
import { listDocuments, getDocument } from '../../vault/documents-service'
import { listFolders } from '../../database/repositories/folders'
import { tiptapToMarkdown, type TTDoc } from '../../markdown/tiptap-markdown'

export interface ToolResult {
  content: string
  error?: string
}

/** Convert a document's stored TipTap JSON into markdown for the agent. */
function docToMarkdown(content: string | null): string {
  if (!content) return ''
  return tiptapToMarkdown(JSON.parse(content) as TTDoc).trim()
}

export function notesListDocuments(db: Database.Database, workspaceId?: string): ToolResult {
  const docs = listDocuments(db, workspaceId)
  const summary = docs.map((d) => ({
    id: d.id,
    title: d.title,
    folder_id: d.folder_id ?? null,
    updated_at: d.updated_at
  }))
  return { content: JSON.stringify(summary, null, 2) }
}

export function notesGetMarkdown(
  db: Database.Database,
  params: { document_id?: string; block_id?: string },
  workspaceId?: string
): ToolResult {
  if (!params.document_id) {
    return { content: '', error: 'document_id must be provided' }
  }

  const doc = getDocument(db, params.document_id)
  if (!doc) {
    return { content: '', error: `Document not found: ${params.document_id}` }
  }
  if (workspaceId && doc.workspace_id !== workspaceId) {
    return { content: '', error: `Document not in current workspace` }
  }

  const body = docToMarkdown(doc.content)
  return {
    content: body.length > 0 ? `# ${doc.title}\n\n${body}` : `# ${doc.title}\n\n(empty document)`
  }
}

export function notesSearch(
  db: Database.Database,
  params: { query: string },
  workspaceId?: string
): ToolResult {
  if (!params.query || params.query.trim().length === 0) {
    return { content: '', error: 'Query must not be empty' }
  }

  // The index mirrors each note's content, so search it directly (title + body).
  const like = `%${params.query}%`
  const rows = (
    workspaceId
      ? db
          .prepare(
            `SELECT id, title, content FROM documents
             WHERE workspace_id = ? AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC LIMIT 20`
          )
          .all(workspaceId, like, like)
      : db
          .prepare(
            `SELECT id, title, content FROM documents
             WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT 20`
          )
          .all(like, like)
  ) as Array<{ id: string; title: string; content: string | null }>

  if (rows.length === 0) {
    return { content: 'No results found.' }
  }

  const needle = params.query.toLowerCase()
  const results = rows.map((r) => {
    const md = docToMarkdown(r.content)
    const idx = md.toLowerCase().indexOf(needle)
    const snippet =
      idx >= 0
        ? md
            .slice(Math.max(0, idx - 40), idx + 80)
            .replace(/\s+/g, ' ')
            .trim()
        : ''
    return { document_id: r.id, document_title: r.title, snippet }
  })

  return { content: JSON.stringify(results, null, 2) }
}

export function notesGetOutline(
  db: Database.Database,
  params: { document_id: string },
  workspaceId?: string
): ToolResult {
  if (!params.document_id) {
    return { content: '', error: 'document_id is required' }
  }

  const doc = getDocument(db, params.document_id)
  if (!doc) {
    return { content: '', error: `Document not found: ${params.document_id}` }
  }
  if (workspaceId && doc.workspace_id !== workspaceId) {
    return { content: '', error: `Document not in current workspace` }
  }

  const body = docToMarkdown(doc.content)
  const headings = body.split('\n').filter((line) => /^#{1,6}\s/.test(line))
  if (headings.length === 0) {
    return { content: `# ${doc.title}\n\n(no headings)` }
  }
  return { content: [`# ${doc.title}`, '', ...headings].join('\n') }
}

export function notesListFolders(db: Database.Database, workspaceId?: string): ToolResult {
  const folders = listFolders(db, workspaceId)
  const summary = folders.map((f) => ({
    id: f.id,
    name: f.name
  }))
  return { content: JSON.stringify(summary, null, 2) }
}
