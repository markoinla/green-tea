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
