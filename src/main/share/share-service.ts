import { app } from 'electron'
import type Database from 'better-sqlite3'
import { join, relative, sep } from 'path'
import type { Document } from '../database/types'
import type { PublishRequest, ShareType } from '../../shared/share-contract'
import { getDocument } from '../vault/documents-service'
import { getWorkspaceVaultDir } from '../vault/paths'
import { getSetting } from '../database/repositories/settings'
import { getShareByDoc, upsertShare, deleteShare } from '../database/repositories/shares'
import { renderNoteToHtml } from './note-renderer'
import { walkArtifactAssets } from './asset-walker'
import { publishToWorker, unpublishFromWorker } from './publish-client'

const DEFAULT_BASE_URL = 'https://share.greentea.app'

/**
 * Published shares are deleted by the worker's R2 bucket lifecycle ~30 days
 * after their last write. The worker exposes no expiry in its API, so we derive
 * it locally from the last publish time. Re-publishing performs a fresh R2 put,
 * which resets that clock — hence re-publishing also renews.
 */
const SHARE_TTL_DAYS = 30
const SHARE_TTL_MS = SHARE_TTL_DAYS * 24 * 60 * 60 * 1000

/** Parse a SQLite `datetime('now')` UTC string ("YYYY-MM-DD HH:MM:SS") as a Date. */
function parseSqliteUtc(s: string): Date {
  return new Date(s.replace(' ', 'T') + 'Z')
}

/** ISO 8601 expiry instant = last publish time + TTL. */
function expiresAtFrom(lastPublish: Date): string {
  return new Date(lastPublish.getTime() + SHARE_TTL_MS).toISOString()
}

/**
 * Resolve the worker token + base URL, mirroring the existing settings-with-env
 * fallback pattern. The token lives ONLY in the settings table or the
 * environment — never hardcoded (green-tea is a public repo) and never logged.
 */
function resolveToken(db: Database.Database): string {
  return getSetting(db, 'share.publishToken') || process.env.SHARE_PUBLISH_TOKEN || ''
}

function resolveBaseUrl(db: Database.Database): string {
  return getSetting(db, 'share.baseUrl') || process.env.SHARE_BASE_URL || DEFAULT_BASE_URL
}

/**
 * The STABLE on-disk identity key for a document, used to key the `shares`
 * table so a published link survives reindex (which rebuilds `documents` and
 * regenerates artifact ids). A note's identity is its frontmatter UUID (durable
 * on disk, equals `documents.id`); an artifact's only stable identity is its
 * workspace-relative path.
 */
function computeDocKey(db: Database.Database, doc: Document): string {
  if (doc.kind === 'note') {
    const fmId = typeof doc.frontmatter?.id === 'string' ? (doc.frontmatter.id as string) : doc.id
    return `note:${fmId}`
  }
  const vaultDir = getWorkspaceVaultDir(db, doc.workspace_id).normalize('NFC')
  const rel = relative(vaultDir, (doc.file_path ?? '').normalize('NFC'))
    .split(sep)
    .join('/')
  return `artifact:${doc.workspace_id}:${rel}`
}

/** Map a document kind to the worker's ShareType. v1: note | html only. */
function shareTypeForKind(kind: Document['kind']): ShareType {
  return kind === 'note' ? 'note' : 'artifact'
}

function loadShareableDoc(db: Database.Database, documentId: string): Document {
  const doc = getDocument(db, documentId)
  if (!doc) throw new Error('Document not found')
  if (doc.kind !== 'note' && doc.kind !== 'html') {
    throw new Error(`Sharing is not supported for ${doc.kind ?? 'this'} documents`)
  }
  if (!doc.file_path) throw new Error('Document has no backing file to share')
  return doc
}

/**
 * Render `doc` and push it to the worker, reusing the prior slug when one exists
 * (so the public URL is stable across re-publishes). Records the result in the
 * local `shares` index and returns the live URL + derived expiry.
 */
async function pushToWorker(
  db: Database.Database,
  doc: Document,
  token: string,
  baseUrl: string
): Promise<{ url: string; slug: string; expiresAt: string }> {
  const docKey = computeDocKey(db, doc)
  const prevSlug = getShareByDoc(db, docKey)?.slug
  const title = doc.title || 'Untitled'

  let req: PublishRequest
  if (doc.kind === 'note') {
    const imagesDir = join(app.getPath('userData'), 'images')
    const html = await renderNoteToHtml(doc, { imagesDir })
    req = { type: 'note', title, html, slug: prevSlug }
  } else {
    const walk = walkArtifactAssets(doc.file_path as string)
    req = {
      type: 'artifact',
      title,
      entryHtml: walk.entryHtml,
      assets: walk.assets,
      slug: prevSlug
    }
  }

  const result = await publishToWorker(baseUrl, token, req)

  const publishedAt = new Date()
  upsertShare(db, docKey, {
    slug: result.slug,
    url: result.url,
    type: shareTypeForKind(doc.kind),
    workspaceId: doc.workspace_id,
    filePath: doc.file_path,
    title
  })

  return { url: result.url, slug: result.slug, expiresAt: expiresAtFrom(publishedAt) }
}

/**
 * Publish (or re-publish) a document's share. Creates a new public link when the
 * document is not yet shared. Throws on a missing token or unshareable document
 * — callers surface the message (IPC → toast). Used by the interactive UI.
 */
export async function publishShare(
  db: Database.Database,
  documentId: string
): Promise<{ url: string; slug: string; expiresAt: string }> {
  const token = resolveToken(db)
  if (!token) throw new Error('Share publish token not configured')
  const doc = loadShareableDoc(db, documentId)
  return pushToWorker(db, doc, token, resolveBaseUrl(db))
}

/** Remove a document's share from the worker and the local index (idempotent). */
export async function unpublishShare(db: Database.Database, documentId: string): Promise<void> {
  const token = resolveToken(db)
  if (!token) throw new Error('Share publish token not configured')
  const doc = getDocument(db, documentId)
  if (!doc) throw new Error('Document not found')
  const docKey = computeDocKey(db, doc)
  const existing = getShareByDoc(db, docKey)
  if (!existing) return // not shared — nothing to do
  await unpublishFromWorker(resolveBaseUrl(db), token, existing.slug)
  deleteShare(db, docKey)
}

/** Current share state for a document, with derived expiry. */
export function getShareStatus(
  db: Database.Database,
  documentId: string
): { shared: boolean; url?: string; slug?: string; expiresAt?: string } {
  const doc = getDocument(db, documentId)
  if (!doc) return { shared: false }
  const existing = getShareByDoc(db, computeDocKey(db, doc))
  if (!existing) return { shared: false }
  return {
    shared: true,
    url: existing.url,
    slug: existing.slug,
    expiresAt: expiresAtFrom(parseSqliteUtc(existing.updated_at))
  }
}

/**
 * Outcome of {@link updateSharedVersion}. Distinct from {@link publishShare}:
 * this NEVER creates a new public link, so an agent (which runs auto-approved
 * and headless in scheduled tasks) cannot expose a private document.
 */
export type UpdateShareResult =
  | { status: 'updated'; url: string; expiresAt: string }
  | { status: 'not-shared' }
  | { status: 'no-token' }
  | { status: 'unsupported'; reason: string }

/**
 * Refresh an EXISTING share with the document's current content (same URL,
 * resets the 30-day clock). A no-op when the document is not already shared —
 * by design, so the human stays the one who decides what becomes public.
 * Returns a discriminated result instead of throwing, so tool callers can map
 * each case to a clear message.
 */
export async function updateSharedVersion(
  db: Database.Database,
  documentId: string
): Promise<UpdateShareResult> {
  const token = resolveToken(db)
  if (!token) return { status: 'no-token' }

  const doc = getDocument(db, documentId)
  if (!doc) return { status: 'unsupported', reason: 'Document not found' }
  if (doc.kind !== 'note' && doc.kind !== 'html') {
    return {
      status: 'unsupported',
      reason: `Sharing is not supported for ${doc.kind ?? 'this'} documents`
    }
  }
  if (!doc.file_path)
    return { status: 'unsupported', reason: 'Document has no backing file to share' }

  if (!getShareByDoc(db, computeDocKey(db, doc))) return { status: 'not-shared' }

  const { url, expiresAt } = await pushToWorker(db, doc, token, resolveBaseUrl(db))
  return { status: 'updated', url, expiresAt }
}
