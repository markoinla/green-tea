import { readdirSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import type { Skill } from '@earendil-works/pi-coding-agent'
import type {
  PublishRegistryRequest,
  PublishRegistryResponse,
  RegistryFilesResponse,
  RegistryItemDetail,
  RegistryItemDetailResponse,
  RegistryItemType,
  RegistryListItem,
  RegistryListResponse,
  RegistryVersionSummary
} from '../../shared/share-contract'
import type { InstalledPlugin } from '../plugins/types'
import { getAccountToken } from '../auth/account'
import { getPluginsDir, installPluginFromRegistry } from '../plugins/manager'
import { getSkillsDir, installSkillFromRegistry } from '../skills/manager'
import {
  HANDLE_REGEX,
  RESERVED_HANDLES,
  SLUG_REGEX,
  VERSION_REGEX,
  parseRegistryItemId,
  readRegistryProvenance,
  validateRegistryFilePath
} from './install-files'

/**
 * Community plugin & skill registry client (marketplace layer two, Phase 3).
 *
 * Talks to the /registry/* endpoints on the share worker. Reads work
 * unauthenticated; publish/report require the account bearer from layer one
 * (read fresh from the encrypted secrets store per request — never cached
 * here). The bearer is also attached to read/download calls when present, so
 * the worker can dedupe install counting per account — EXCEPT the manifest-only
 * consent peek, which is sent unauthenticated so it never counts as an install.
 */

const DEFAULT_BASE_URL = 'https://share.greentea.app'

/**
 * The registry host — the SAME worker/host as sharing. Mirrors the
 * `SHARE_BASE_URL` convention in `share/share-service.ts` (hardcoded default,
 * env override for dev/self-host).
 */
function resolveBaseUrl(): string {
  return (process.env.SHARE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/**
 * Authorization headers for a registry call. When `required`, throws a
 * user-facing error if signed out; otherwise the header is simply omitted
 * (reads are public).
 */
function authHeaders(db: Database.Database, required = false): Record<string, string> {
  const token = getAccountToken(db)
  if (!token) {
    if (required) {
      throw new Error('Sign in to your Green Tea account to do this.')
    }
    return {}
  }
  return { Authorization: `Bearer ${token}` }
}

export class RegistryRequestError extends Error {
  readonly status: number

  constructor(status: number, detail: string) {
    super(`Registry request failed (${status})${detail ? `: ${detail}` : ''}`)
    this.name = 'RegistryRequestError'
    this.status = status
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string } | null
      detail = body && typeof body.error === 'string' ? body.error : JSON.stringify(body)
    } catch {
      // ignore non-JSON error bodies
    }
    throw new RegistryRequestError(res.status, detail)
  }
  return (await res.json()) as T
}

/**
 * The route prefix for an item: two explicit, individually-validated segments
 * (`/registry/items/<handle>/<slug>`) — the id is never sent as one segment.
 */
function itemRoute(itemId: string): string {
  const { handle, slug } = parseRegistryItemId(itemId)
  return `/registry/items/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`
}

export interface RegistrySearchOptions {
  q?: string
  sort?: 'installs' | 'recent'
  type?: RegistryItemType
}

/** GET /registry/items — community search/browse. Unauthenticated-friendly. */
export async function searchRegistry(
  db: Database.Database,
  opts: RegistrySearchOptions = {}
): Promise<RegistryListItem[]> {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  if (opts.sort) params.set('sort', opts.sort)
  if (opts.type) params.set('type', opts.type)
  const qs = params.toString()
  const data = await requestJson<RegistryListResponse>(
    `${resolveBaseUrl()}/registry/items${qs ? `?${qs}` : ''}`,
    { headers: authHeaders(db) }
  )
  return data.items
}

/**
 * The flattened item-detail shape exposed over IPC to the renderer: the
 * worker's wrapped `{ item, versions }` detail response merged into one
 * object, plus the `slug` half of the item id (the worker's detail payload
 * only carries the composed id).
 */
export interface RegistryItemWithVersions extends RegistryItemDetail {
  slug: string
  versions: RegistryVersionSummary[]
}

/** GET /registry/items/:handle/:slug — item detail + versions. */
export async function getRegistryItem(
  db: Database.Database,
  itemId: string
): Promise<RegistryItemWithVersions> {
  const data = await requestJson<RegistryItemDetailResponse>(
    `${resolveBaseUrl()}${itemRoute(itemId)}`,
    { headers: authHeaders(db) }
  )
  return { ...data.item, slug: parseRegistryItemId(itemId).slug, versions: data.versions }
}

/**
 * Resolve a version's server-validated manifest WITHOUT downloading file
 * bytes — the renderer uses this for the pre-install permission-consent
 * dialog. Defaults to the item's latest version.
 */
export async function getRegistryVersionManifest(
  db: Database.Database,
  itemId: string,
  version?: string
): Promise<{ version: string; manifest: Record<string, unknown> }> {
  const resolvedVersion = version ?? (await getRegistryItem(db, itemId)).latestVersion
  if (!VERSION_REGEX.test(resolvedVersion)) {
    throw new Error(`Invalid registry version "${resolvedVersion}"`)
  }
  // Deliberately UNAUTHENTICATED: an account bearer on the files endpoint
  // records a deduplicated install server-side, and this fetch happens BEFORE
  // the user has consented to install (they may click Cancel). Unauthenticated
  // files GETs are explicitly supported and never counted — the bearer stays
  // on installFromRegistry's files fetch only.
  const filesRes = await requestJson<RegistryFilesResponse>(
    `${resolveBaseUrl()}${itemRoute(itemId)}/versions/${encodeURIComponent(resolvedVersion)}/files`
  )
  return { version: resolvedVersion, manifest: filesRes.manifest }
}

/**
 * Validate a publisher handle client-side. The claim itself is finalized
 * ATOMICALLY server-side on the user's first publish (`POST /registry/publish`
 * carries `handle`); there is no separate claim endpoint, so this exists for
 * fast pre-publish feedback in the handle-claim prompt. Handles are permanent.
 */
export function claimHandle(handle: string): { ok: boolean; error?: string } {
  if (typeof handle !== 'string' || handle.length === 0) {
    return { ok: false, error: 'Enter a handle.' }
  }
  if (!HANDLE_REGEX.test(handle)) {
    return {
      ok: false,
      error:
        'Handles are 1-39 lowercase letters, digits or hyphens, and cannot start or end with a hyphen.'
    }
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, error: `The handle "${handle}" is reserved.` }
  }
  return { ok: true }
}

/** POST /registry/publish — requires the account bearer. */
export async function publishToRegistry(
  db: Database.Database,
  request: PublishRegistryRequest
): Promise<PublishRegistryResponse> {
  if (request.type !== 'skill' && request.type !== 'plugin') {
    throw new Error('Registry publish type must be "skill" or "plugin"')
  }
  if (!SLUG_REGEX.test(request.slug)) {
    throw new Error(`Invalid registry slug "${request.slug}"`)
  }
  if (!VERSION_REGEX.test(request.version)) {
    throw new Error(`Invalid version "${request.version}" (expected release semver, e.g. "1.2.0")`)
  }
  if (request.handle !== undefined) {
    const check = claimHandle(request.handle)
    if (!check.ok) throw new Error(check.error)
  }
  for (const file of request.files) {
    validateRegistryFilePath(file.path)
  }

  return requestJson<PublishRegistryResponse>(`${resolveBaseUrl()}/registry/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(db, true) },
    body: JSON.stringify(request)
  })
}

/** Reason cap mirrored from the worker's report validation. */
const REPORT_REASON_MAX = 2000

/** POST /registry/items/:handle/:slug/report — requires the account bearer. */
export async function reportRegistryItem(
  db: Database.Database,
  itemId: string,
  reason: string
): Promise<void> {
  const trimmed = typeof reason === 'string' ? reason.trim() : ''
  if (!trimmed) {
    throw new Error('A report reason is required.')
  }
  if (trimmed.length > REPORT_REASON_MAX) {
    throw new Error(`Report reason is too long (max ${REPORT_REASON_MAX} characters).`)
  }
  await requestJson<unknown>(`${resolveBaseUrl()}${itemRoute(itemId)}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(db, true) },
    body: JSON.stringify({ reason: trimmed })
  })
}

/** Numeric compare of two strict release-semver strings ('1.10.0' > '1.9.0'). */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

export interface RegistryInstalledRef {
  itemId: string
  /**
   * The item's registry type, from the provenance marker (legacy markers
   * without one get it inferred from the containing plugins/skills dir).
   * Renderer badging/gating must correlate on type + slug, never slug alone.
   */
  type: RegistryItemType
  version: string
}

export interface RegistryUpdate {
  itemId: string
  installedVersion: string
  latestVersion: string
}

/**
 * The worker silently caps the batched `?ids=` list at 100 (MAX_IDS in
 * registry-routes.ts) — larger installed sets must be chunked client-side or
 * everything past the cap never sees updates.
 */
const CHECK_UPDATES_CHUNK_SIZE = 100

/**
 * Batched passive update check: `GET /registry/items?ids=a,b,c` in chunks of
 * ≤100 ids (the worker's cap), then a strict-semver comparison against each
 * installed version. Items the server no longer returns (banned) or with
 * unparseable versions are silently skipped.
 */
export async function checkRegistryUpdates(
  db: Database.Database,
  installed: Pick<RegistryInstalledRef, 'itemId' | 'version'>[]
): Promise<RegistryUpdate[]> {
  const valid = installed.filter((ref) => {
    try {
      parseRegistryItemId(ref.itemId)
      return VERSION_REGEX.test(ref.version)
    } catch {
      return false
    }
  })
  if (valid.length === 0) return []

  const latestById = new Map<string, string>()
  for (let i = 0; i < valid.length; i += CHECK_UPDATES_CHUNK_SIZE) {
    const chunk = valid.slice(i, i + CHECK_UPDATES_CHUNK_SIZE)
    const params = new URLSearchParams({ ids: chunk.map((ref) => ref.itemId).join(',') })
    const data = await requestJson<RegistryListResponse>(
      `${resolveBaseUrl()}/registry/items?${params.toString()}`,
      { headers: authHeaders(db) }
    )
    for (const item of data.items) {
      latestById.set(item.id, item.latestVersion)
    }
  }

  const updates: RegistryUpdate[] = []
  for (const ref of valid) {
    const latest = latestById.get(ref.itemId)
    if (!latest || !VERSION_REGEX.test(latest)) continue
    if (compareVersions(latest, ref.version) > 0) {
      updates.push({ itemId: ref.itemId, installedVersion: ref.version, latestVersion: latest })
    }
  }
  return updates
}

/**
 * Registry provenance for everything currently installed — the source of truth
 * for update checks and for gating consent/publish UI to registry-sourced
 * items. Scans the plugin and skill dirs for `.registry.json` markers.
 */
export function listRegistryInstalls(db: Database.Database): RegistryInstalledRef[] {
  const refs: RegistryInstalledRef[] = []
  const roots: { baseDir: string; dirType: RegistryItemType }[] = [
    { baseDir: getPluginsDir(db), dirType: 'plugin' },
    { baseDir: getSkillsDir(db), dirType: 'skill' }
  ]
  for (const { baseDir, dirType } of roots) {
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const provenance = readRegistryProvenance(join(baseDir, entry.name))
      if (provenance) {
        // Legacy markers (written before `type` existed) lack the field; the
        // containing directory determines the type unambiguously.
        refs.push({
          itemId: provenance.itemId,
          type: provenance.type ?? dirType,
          version: provenance.version
        })
      }
    }
  }
  return refs
}

export type RegistryInstallResult =
  | { type: 'plugin'; plugin: InstalledPlugin }
  | { type: 'skill'; skill: Skill }

/**
 * Install (or update) a registry item: resolve the item (type + latest
 * version), fetch the version's validated manifest + file list, download each
 * file's bytes from the worker-proxied file route (paths validated BEFORE any
 * fetch or write), then hand off to the type-specific validate-then-write
 * installer in plugins/manager.ts or skills/manager.ts.
 */
export async function installFromRegistry(
  db: Database.Database,
  itemId: string,
  version?: string
): Promise<RegistryInstallResult> {
  const base = resolveBaseUrl()
  const route = itemRoute(itemId)
  const headers = authHeaders(db)

  const item = await getRegistryItem(db, itemId)
  const resolvedVersion = version ?? item.latestVersion
  if (!VERSION_REGEX.test(resolvedVersion)) {
    throw new Error(`Invalid registry version "${resolvedVersion}"`)
  }

  const filesRes = await requestJson<RegistryFilesResponse>(
    `${base}${route}/versions/${encodeURIComponent(resolvedVersion)}/files`,
    { headers }
  )

  // Validate every path up front — a single hostile path aborts the install
  // before anything is fetched or written.
  for (const file of filesRes.files) {
    validateRegistryFilePath(file.path)
  }

  const files: { path: string; content: Buffer }[] = []
  for (const file of filesRes.files) {
    const encodedPath = file.path.split('/').map(encodeURIComponent).join('/')
    const res = await fetch(
      `${base}${route}/versions/${encodeURIComponent(resolvedVersion)}/file/${encodedPath}`,
      { headers }
    )
    if (!res.ok) {
      throw new Error(`Failed to download registry file "${file.path}" (${res.status})`)
    }
    files.push({ path: file.path, content: Buffer.from(await res.arrayBuffer()) })
  }

  if (item.type === 'plugin') {
    const plugin = installPluginFromRegistry(db, {
      itemId,
      version: resolvedVersion,
      manifest: filesRes.manifest,
      files
    })
    return { type: 'plugin', plugin }
  }

  const skill = installSkillFromRegistry(db, { itemId, version: resolvedVersion, files })
  return { type: 'skill', skill }
}
