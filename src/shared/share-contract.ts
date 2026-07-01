// Copied VERBATIM from green-tea-proxy/shared/contract.ts (the worker is the
// source of truth). Dependency-free TypeScript types describing the
// greentea-share worker's public API contract. No imports, no runtime code —
// types only. Both the main process (publish client) and the renderer depend on
// these exact shapes; do NOT edit here, edit the worker's contract and re-copy.

export type ShareType = 'note' | 'artifact'

export interface PublishNoteRequest {
  type: 'note'
  title: string
  html: string
  slug?: string
}

export interface PublishArtifactAsset {
  path: string
  contentBase64: string
}

export interface PublishArtifactRequest {
  type: 'artifact'
  title: string
  entryHtml: string
  assets: PublishArtifactAsset[]
  slug?: string
}

export type PublishRequest = PublishNoteRequest | PublishArtifactRequest

export interface PublishResponse {
  slug: string
  url: string
}

export interface RegisterResponse {
  deviceId: string
  deviceSecret: string
}

// --- Marketplace accounts / auth layer one (copied VERBATIM from the worker) ---

export interface AccountUser {
  id: string
  email: string
  name?: string
  image?: string
}

export interface DesktopAuthorizeRequest {
  redirect: string
  state: string
  code_challenge: string
}

export interface DesktopTokenRequest {
  code: string
  code_verifier: string
  device?: { id: string; secret: string }
}

export interface DesktopTokenResponse {
  token: string
  user: AccountUser
}

// --- Community registry (marketplace layer two, host: share.greentea.app) --

export type RegistryItemType = 'skill' | 'plugin'

export interface RegistryPackageFile {
  path: string
  contentBase64: string
}

// POST /registry/publish  (auth: account bearer — apiKey — required)
export interface PublishRegistryRequest {
  type: RegistryItemType
  /** ^[a-z0-9][a-z0-9-]{0,63}$ ; skills additionally forbid '--' and must equal
   * the SKILL.md frontmatter name; plugins must equal manifest.id. */
  slug: string
  /** Required only on a user's first-ever publish (handle claim). */
  handle?: string
  /** Release-only semver (MAJOR.MINOR.PATCH — no prerelease/build/'v' prefix),
   * strictly greater than the item's latest version when the item exists. */
  version: string
  /** PluginManifest shape for plugins; ignored for skills (SKILL.md frontmatter
   * is authoritative — the server derives the stored manifest from it). */
  manifest: Record<string, unknown>
  files: RegistryPackageFile[]
}

export interface PublishRegistryResponse {
  /** '<handle>/<slug>' */
  id: string
  version: string
}

/**
 * Reader-visible item status. 'banned' items 404 everywhere and are never
 * returned; 'delisted' appears only when resolving explicit ids (the batched
 * update check) or the detail/files routes — search lists 'published' only.
 */
export type RegistryItemStatus = 'published' | 'delisted'

// GET /registry/items?q=<text>&sort=installs|recent&type=skill|plugin&ids=a/b,c/d
// (no auth; ?ids= is the batched update check and also resolves delisted items)
export interface RegistryListItem {
  /** '<handle>/<slug>' */
  id: string
  type: RegistryItemType
  name: string
  description: string
  handle: string
  latestVersion: string
  installCount: number
  updatedAt: number
  status: RegistryItemStatus
}

export interface RegistryListResponse {
  items: RegistryListItem[]
}

// GET /registry/items/:handle/:slug  (item detail + all versions, newest first)
export interface RegistryVersionSummary {
  version: string
  sizeBytes: number
  createdAt: number
}

export interface RegistryItemDetail extends RegistryListItem {
  createdAt: number
}

export interface RegistryItemDetailResponse {
  item: RegistryItemDetail
  versions: RegistryVersionSummary[]
}

// GET /registry/items/:handle/:slug/versions/:version/files
// `manifest` is the server-validated manifest_json (for skills, derived from
// SKILL.md frontmatter). Each file's bytes are fetched from the worker at
//   GET /registry/items/:handle/:slug/versions/:version/file/<path>
// (worker-proxied R2 stream — there are no presigned URLs). An account bearer
// on the files fetch records a deduplicated install; unauthenticated fetches
// work but do not count.
export interface RegistryFilesResponse {
  manifest: Record<string, unknown>
  files: { path: string; sizeBytes: number }[]
}

// POST /registry/items/:handle/:slug/report  (auth: account bearer, required)
export interface ReportRegistryRequest {
  reason: string // 1-2000 chars
}

export interface ReportRegistryResponse {
  ok: true
}

// POST /registry/items/:handle/:slug/moderate  (auth: REGISTRY_ADMIN_TOKEN)
export interface ModerateRegistryRequest {
  action: 'delist' | 'ban_author'
}

export interface ModerateRegistryResponse {
  /** '<handle>/<slug>' */
  id: string
  /** Resulting status of the TARGET item ('banned' for ban_author). */
  status: 'delisted' | 'banned'
}
