export interface MicrosoftTokens {
  access_token: string
  refresh_token: string
  scope: string
  token_type: string
  expiry_date: number
}

export type MicrosoftServiceType = 'outlook'

export interface MicrosoftAuthData {
  tokens?: MicrosoftTokens
  scopes: string[]
  enabledServices: MicrosoftServiceType[]
  codeVerifier?: string
}

export interface MicrosoftAccountStatus {
  authenticated: boolean
  email?: string
  displayName?: string
  scopes: string[]
  enabledServices: MicrosoftServiceType[]
}

export const MICROSOFT_SCOPES = {
  USER_READ: 'User.Read',
  MAIL_READ: 'Mail.Read',
  OFFLINE_ACCESS: 'offline_access'
} as const

export const MS_SERVICE_SCOPES: Record<MicrosoftServiceType, string[]> = {
  outlook: [MICROSOFT_SCOPES.USER_READ, MICROSOFT_SCOPES.MAIL_READ, MICROSOFT_SCOPES.OFFLINE_ACCESS]
}

export interface OutlookMessage {
  id: string
  subject: string
  bodyPreview: string
  body?: { contentType: string; content: string }
  from?: { emailAddress: { name: string; address: string } }
  toRecipients?: { emailAddress: { name: string; address: string } }[]
  ccRecipients?: { emailAddress: { name: string; address: string } }[]
  receivedDateTime: string
  isRead: boolean
  hasAttachments: boolean
  webLink?: string
  importance?: string
  conversationId?: string
}

export interface OutlookMessageListResponse {
  value: OutlookMessage[]
  '@odata.nextLink'?: string
  '@odata.count'?: number
}
