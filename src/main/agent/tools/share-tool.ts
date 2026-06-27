import type Database from 'better-sqlite3'
import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { updateSharedVersion } from '../../share/share-service'

/**
 * Refresh the public, already-published copy of a note or HTML artifact so it
 * matches the document's current content. By design this NEVER creates a new
 * public link — it is a no-op when the document is not already shared. That
 * keeps the human as the sole party who decides what becomes public, which
 * matters because this tool runs auto-approved and headless inside scheduled
 * tasks. Typical use: a scheduled task edits a note and then refreshes its share
 * so readers see the update at the same URL.
 */
export function createUpdateShareTool(db: Database.Database): ToolDefinition {
  return {
    name: 'update_shared_version',
    label: 'Update Shared Version',
    description:
      "Update the published public copy of an already-shared note or HTML artifact to match its current content, at the same URL (this also renews the share's 30-day expiry). Does NOT create a new public link: if the document isn't already shared, it reports that and makes no change — ask the user to create the share first. Use this after editing a document that the user has shared, e.g. inside a scheduled task that keeps a published page in sync.",
    parameters: Type.Object({
      document_id: Type.String({
        description: 'The note/artifact ID whose existing public share should be refreshed.'
      })
    }),
    async execute(_toolCallId, params) {
      const { document_id } = params as { document_id: string }
      const result = await updateSharedVersion(db, document_id)

      let text: string
      switch (result.status) {
        case 'updated':
          text = `Updated the shared version. Public URL: ${result.url} (link valid until ${result.expiresAt}).`
          break
        case 'not-shared':
          text =
            'This document is not shared, so there is nothing to update. Ask the user to create a public link first (Share button in the document header).'
          break
        case 'no-token':
          text =
            'Cannot update the share: no publish token is configured. Set it in Settings → Share.'
          break
        case 'unsupported':
          text = `Cannot update the share: ${result.reason}.`
          break
      }

      return { content: [{ type: 'text' as const, text }], details: undefined }
    }
  }
}
