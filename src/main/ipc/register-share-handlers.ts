import { ipcMain, app } from 'electron'
import type Database from 'better-sqlite3'
import { join, relative, sep } from 'path'
import type { IpcHandlerContext } from './context'
import type { Document } from '../database/types'
import type { PublishRequest, ShareType } from '../../shared/share-contract'
import { getDocument } from '../vault/documents-service'
import { getWorkspaceVaultDir } from '../vault/paths'
import { getSetting } from '../database/repositories/settings'
import { getShareByDoc, upsertShare, deleteShare } from '../database/repositories/shares'
import { renderNoteToHtml } from '../share/note-renderer'
import { walkArtifactAssets } from '../share/asset-walker'
import { publishToWorker, unpublishFromWorker } from '../share/publish-client'

const DEFAULT_BASE_URL = 'https://share.greentea.app'

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

export function registerShareHandlers({ db }: IpcHandlerContext): void {
  ipcMain.handle(
    'share:publish',
    async (_event, documentId: string): Promise<{ url: string; slug: string }> => {
      const token = resolveToken(db)
      if (!token) throw new Error('Share publish token not configured')
      const baseUrl = resolveBaseUrl(db)

      const doc = loadShareableDoc(db, documentId)
      const docKey = computeDocKey(db, doc)
      const existing = getShareByDoc(db, docKey)
      const prevSlug = existing?.slug
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

      upsertShare(db, docKey, {
        slug: result.slug,
        url: result.url,
        type: shareTypeForKind(doc.kind),
        workspaceId: doc.workspace_id,
        filePath: doc.file_path,
        title
      })

      return { url: result.url, slug: result.slug }
    }
  )

  ipcMain.handle('share:unpublish', async (_event, documentId: string): Promise<void> => {
    const token = resolveToken(db)
    if (!token) throw new Error('Share publish token not configured')
    const baseUrl = resolveBaseUrl(db)

    const doc = getDocument(db, documentId)
    if (!doc) throw new Error('Document not found')
    const docKey = computeDocKey(db, doc)
    const existing = getShareByDoc(db, docKey)
    if (!existing) return // not shared — nothing to do

    await unpublishFromWorker(baseUrl, token, existing.slug)
    deleteShare(db, docKey)
  })

  ipcMain.handle(
    'share:status',
    async (
      _event,
      documentId: string
    ): Promise<{ shared: boolean; url?: string; slug?: string }> => {
      const doc = getDocument(db, documentId)
      if (!doc) return { shared: false }
      const existing = getShareByDoc(db, computeDocKey(db, doc))
      if (!existing) return { shared: false }
      return { shared: true, url: existing.url, slug: existing.slug }
    }
  )
}
