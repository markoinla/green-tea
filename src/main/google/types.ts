export interface GoogleTokens {
  access_token: string
  refresh_token: string
  scope: string
  token_type: string
  expiry_date: number
}

export type GoogleServiceType = 'calendar' | 'gmail' | 'drive'

export interface GoogleAuthData {
  tokens?: GoogleTokens
  scopes: string[]
  enabledServices: GoogleServiceType[]
  codeVerifier?: string
}

export interface GoogleAccountStatus {
  authenticated: boolean
  email?: string
  scopes: string[]
  enabledServices: GoogleServiceType[]
}

export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: { email: string; displayName?: string; responseStatus?: string }[]
  htmlLink?: string
  status?: string
  organizer?: { email: string; displayName?: string }
}

export const GOOGLE_SCOPES = {
  CALENDAR_READONLY: 'https://www.googleapis.com/auth/calendar.readonly',
  GMAIL_READONLY: 'https://www.googleapis.com/auth/gmail.readonly',
  DRIVE: 'https://www.googleapis.com/auth/drive',
  DOCUMENTS: 'https://www.googleapis.com/auth/documents',
  SPREADSHEETS: 'https://www.googleapis.com/auth/spreadsheets',
  PRESENTATIONS: 'https://www.googleapis.com/auth/presentations'
} as const

export const SERVICE_SCOPES: Record<GoogleServiceType, string[]> = {
  calendar: [GOOGLE_SCOPES.CALENDAR_READONLY],
  gmail: [GOOGLE_SCOPES.GMAIL_READONLY],
  drive: [
    GOOGLE_SCOPES.DRIVE,
    GOOGLE_SCOPES.DOCUMENTS,
    GOOGLE_SCOPES.SPREADSHEETS,
    GOOGLE_SCOPES.PRESENTATIONS
  ]
}

// Gmail types
export interface GmailMessageHeader {
  name: string
  value: string
}

export interface GmailMessagePart {
  mimeType: string
  headers?: GmailMessageHeader[]
  body?: { size: number; data?: string }
  parts?: GmailMessagePart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  payload?: {
    mimeType: string
    headers?: GmailMessageHeader[]
    body?: { size: number; data?: string }
    parts?: GmailMessagePart[]
  }
  internalDate?: string
}

export interface GmailMessageListResponse {
  messages?: { id: string; threadId: string }[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

// Drive types
export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  webViewLink?: string
  owners?: { displayName: string; emailAddress: string }[]
}

export interface DriveFileListResponse {
  files?: DriveFile[]
  nextPageToken?: string
}
