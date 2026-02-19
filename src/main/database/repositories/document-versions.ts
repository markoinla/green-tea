import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { DocumentVersion } from '../types'
import { getDocument } from './documents'

// In-memory throttle: document_id -> last auto-version timestamp (ms)
const autoVersionThrottle = new Map<string, number>()
const THROTTLE_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

export function createVersion(
  db: Database.Database,
  data: { document_id: string; title: string; content: string | null; source: string }
): DocumentVersion {
  const id = randomUUID()
  db.prepare(
    'INSERT INTO document_versions (id, document_id, title, content, source) VALUES (?, ?, ?, ?, ?)'
  ).run(id, data.document_id, data.title, data.content, data.source)
  return db.prepare('SELECT * FROM document_versions WHERE id = ?').get(id) as DocumentVersion
}

export function listVersions(
  db: Database.Database,
  documentId: string,
  limit = 50
): DocumentVersion[] {
  return db
    .prepare(
      'SELECT * FROM document_versions WHERE document_id = ? ORDER BY created_at DESC LIMIT ?'
    )
    .all(documentId, limit) as DocumentVersion[]
}

export function getVersion(db: Database.Database, id: string): DocumentVersion | undefined {
  return db.prepare('SELECT * FROM document_versions WHERE id = ?').get(id) as
    | DocumentVersion
    | undefined
}

export function restoreVersion(db: Database.Database, versionId: string): void {
  const version = getVersion(db, versionId)
  if (!version) throw new Error(`Version not found: ${versionId}`)

  const doc = getDocument(db, version.document_id)
  if (!doc) throw new Error(`Document not found: ${version.document_id}`)

  // Snapshot current state before restoring
  createVersion(db, {
    document_id: doc.id,
    title: doc.title,
    content: doc.content,
    source: 'restore'
  })

  // Overwrite document with the version's content and title
  db.prepare(
    "UPDATE documents SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(version.title, version.content, version.document_id)
}

export function deleteVersion(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM document_versions WHERE id = ?').run(id)
}

export function maybeCreateAutoVersion(
  db: Database.Database,
  documentId: string,
  currentTitle: string,
  currentContent: string | null
): void {
  const now = Date.now()
  const lastTime = autoVersionThrottle.get(documentId) ?? 0

  if (now - lastTime < THROTTLE_INTERVAL_MS) return

  autoVersionThrottle.set(documentId, now)

  createVersion(db, {
    document_id: documentId,
    title: currentTitle,
    content: currentContent,
    source: 'autosave'
  })
}

export function pruneVersions(db: Database.Database): void {
  const now = new Date()

  // Get all documents that have versions
  const docIds = db.prepare('SELECT DISTINCT document_id FROM document_versions').all() as {
    document_id: string
  }[]

  for (const { document_id } of docIds) {
    const versions = db
      .prepare(
        'SELECT id, source, created_at FROM document_versions WHERE document_id = ? ORDER BY created_at DESC'
      )
      .all(document_id) as Pick<DocumentVersion, 'id' | 'source' | 'created_at'>[]

    const toDelete: string[] = []

    // Group versions by retention bucket
    const hourBuckets = new Map<string, typeof versions>()
    const dayBuckets = new Map<string, typeof versions>()

    for (const v of versions) {
      const created = new Date(v.created_at + 'Z')
      const ageMs = now.getTime() - created.getTime()
      const ageHours = ageMs / (1000 * 60 * 60)
      const ageDays = ageHours / 24

      if (ageHours < 24) {
        // Keep all versions < 24h
        continue
      }

      if (ageDays <= 7) {
        // 1-7 days: keep 1 per hour (skip manual and agent_patch)
        if (v.source === 'manual' || v.source === 'agent_patch') continue
        const hourKey = created.toISOString().slice(0, 13) // YYYY-MM-DDTHH
        if (!hourBuckets.has(hourKey)) hourBuckets.set(hourKey, [])
        hourBuckets.get(hourKey)!.push(v)
      } else if (ageDays <= 30) {
        // 7-30 days: keep 1 per day (skip manual and agent_patch)
        if (v.source === 'manual' || v.source === 'agent_patch') continue
        const dayKey = created.toISOString().slice(0, 10) // YYYY-MM-DD
        if (!dayBuckets.has(dayKey)) dayBuckets.set(dayKey, [])
        dayBuckets.get(dayKey)!.push(v)
      } else {
        // 30+ days: delete autosave and restore, keep manual and agent_patch
        if (v.source === 'autosave' || v.source === 'restore') {
          toDelete.push(v.id)
        }
      }
    }

    // For hour buckets: keep newest, delete rest
    for (const bucket of hourBuckets.values()) {
      // bucket[0] is newest (already sorted DESC)
      for (let i = 1; i < bucket.length; i++) {
        toDelete.push(bucket[i].id)
      }
    }

    // For day buckets: keep newest, delete rest
    for (const bucket of dayBuckets.values()) {
      for (let i = 1; i < bucket.length; i++) {
        toDelete.push(bucket[i].id)
      }
    }

    if (toDelete.length > 0) {
      const placeholders = toDelete.map(() => '?').join(',')
      db.prepare(`DELETE FROM document_versions WHERE id IN (${placeholders})`).run(...toDelete)
    }
  }
}
