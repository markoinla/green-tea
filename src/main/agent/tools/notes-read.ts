import type Database from 'better-sqlite3'
import {
  listDocuments,
  getDocument,
  listByProperty,
  getBacklinks
} from '../../vault/documents-service'
import { listFolders } from '../../database/repositories/folders'
import { fold } from '../../vault/metadata'
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

/** The uniform refusal for markdown-shaped operations on a rendered artifact. */
function artifactRejectMessage(title: string, kind: string): string {
  return `"${title}" is a ${kind} artifact, not a markdown note — it is rendered, not editable as text. Markdown read/patch tools do not apply. Regenerate the file on disk to change it.`
}

/**
 * The indexed properties for a set of documents, grouped by document then key.
 * Sources `document_properties` (the EAV substrate) so the agent sees exactly the
 * queryable values, including one entry per `list`/`tags` element. Single-valued
 * keys collapse to a scalar; multi-valued keys (and `tags`) stay arrays.
 */
function propertiesForDocs(
  db: Database.Database,
  docIds: string[]
): Map<string, Record<string, string | string[]>> {
  const out = new Map<string, Record<string, string | string[]>>()
  if (docIds.length === 0) return out
  const placeholders = docIds.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT document_id, key, value FROM document_properties
       WHERE document_id IN (${placeholders})`
    )
    .all(...docIds) as { document_id: string; key: string; value: string }[]
  for (const r of rows) {
    let props = out.get(r.document_id)
    if (!props) {
      props = {}
      out.set(r.document_id, props)
    }
    const existing = props[r.key]
    if (existing === undefined) {
      // `tags` is always an array (frontmatter tags only — see notes_query).
      props[r.key] = r.key === 'tags' ? [r.value] : r.value
    } else if (Array.isArray(existing)) {
      existing.push(r.value)
    } else {
      props[r.key] = [existing, r.value]
    }
  }
  return out
}

export function notesListDocuments(db: Database.Database, workspaceId?: string): ToolResult {
  const docs = listDocuments(db, workspaceId)
  const props = propertiesForDocs(
    db,
    docs.map((d) => d.id)
  )
  const summary = docs.map((d) => {
    const p = props.get(d.id) ?? {}
    const { tags, ...properties } = p
    return {
      id: d.id,
      title: d.title,
      // 'note' is editable markdown; any other kind is a rendered artifact — the
      // agent can reference its id but cannot read/patch it as markdown.
      kind: d.kind ?? 'note',
      folder_id: d.folder_id ?? null,
      updated_at: d.updated_at,
      // Frontmatter tags only (v1 does not index inline #tags in note bodies).
      tags: Array.isArray(tags) ? tags : tags !== undefined ? [tags] : [],
      properties
    }
  })
  return { content: JSON.stringify(summary, null, 2) }
}

/**
 * Filter notes by an indexed property or tag over `document_properties`. The
 * predicate is EQUALITY on `value_fold` (case-insensitive, NFC-folded), composed
 * with workspace scoping — the same predicate the human click-to-filter uses.
 *
 * Contract:
 * - `key`: any property name (e.g. `status`, `priority`), or `tags`.
 * - `value`: the value to match. For `date`/`number` properties the match is on
 *   the coerced TEXT (e.g. `priority` value `2` matches `"2"`). Case-insensitive.
 * - Tag queries are FRONTMATTER TAGS ONLY: inline `#tags` in note bodies are not
 *   indexed in v1, so a tag result is not a complete view of every note using it.
 */
export function notesQuery(
  db: Database.Database,
  params: { key: string; value: string },
  workspaceId?: string
): ToolResult {
  if (!params.key || params.key.trim().length === 0) {
    return { content: '', error: 'key is required' }
  }
  if (params.value === undefined || params.value === null) {
    return { content: '', error: 'value is required' }
  }
  if (!workspaceId) {
    return { content: '', error: 'No workspace context available' }
  }

  const key = params.key.trim()
  const docs = listByProperty(db, workspaceId, key, fold(String(params.value)))
  const results = docs.map((d) => ({
    id: d.id,
    title: d.title,
    folder_id: d.folder_id ?? null,
    updated_at: d.updated_at
  }))
  const note =
    key === 'tags' ? ' (frontmatter tags only — inline #tags in note bodies are not indexed)' : ''
  if (results.length === 0) {
    return { content: `No notes match ${key} = "${params.value}"${note}.` }
  }
  return {
    content: `${results.length} note(s) match ${key} = "${params.value}"${note}:\n${JSON.stringify(
      results,
      null,
      2
    )}`
  }
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
  if (doc.kind && doc.kind !== 'note') {
    return { content: '', error: artifactRejectMessage(doc.title, doc.kind) }
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
  // Artifacts carry content=null and are not text-searchable — exclude them so a
  // title-only match never surfaces a rendered artifact with an empty snippet.
  const like = `%${params.query}%`
  const rows = (
    workspaceId
      ? db
          .prepare(
            `SELECT id, title, content FROM documents
             WHERE workspace_id = ? AND content IS NOT NULL AND (title LIKE ? OR content LIKE ?)
             ORDER BY updated_at DESC LIMIT 20`
          )
          .all(workspaceId, like, like)
      : db
          .prepare(
            `SELECT id, title, content FROM documents
             WHERE content IS NOT NULL AND (title LIKE ? OR content LIKE ?)
             ORDER BY updated_at DESC LIMIT 20`
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
  if (doc.kind && doc.kind !== 'note') {
    return { content: '', error: artifactRejectMessage(doc.title, doc.kind) }
  }

  const body = docToMarkdown(doc.content)
  const headings = body.split('\n').filter((line) => /^#{1,6}\s/.test(line))
  if (headings.length === 0) {
    return { content: `# ${doc.title}\n\n(no headings)` }
  }
  return { content: [`# ${doc.title}`, '', ...headings].join('\n') }
}

export function notesGetBacklinks(
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

  const backlinks = getBacklinks(db, params.document_id)
  if (backlinks.length === 0) {
    return { content: `No notes link to "${doc.title}".` }
  }
  return { content: JSON.stringify(backlinks, null, 2) }
}

export function notesListFolders(db: Database.Database, workspaceId?: string): ToolResult {
  const folders = listFolders(db, workspaceId)
  const summary = folders.map((f) => ({
    id: f.id,
    name: f.name
  }))
  return { content: JSON.stringify(summary, null, 2) }
}
