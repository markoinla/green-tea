import type Database from 'better-sqlite3'
import { Type } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import {
  logDocumentHistory,
  logWorkspaceHistory,
  showDocumentAtRef,
  diffDocument
} from '../../git/workspace-git'
import type { GitLogEntry } from '../../git/git-service'

/**
 * READ-ONLY git tools for the agent (Phase 3, §4.8/§6). The workspace vault is a
 * local git repo (Phase 1/2), so the agent can reason about history — "what
 * changed", "diff this note against a past commit", "show this note as it was".
 *
 * Strictly read-only by design: there are NO mutating git tools here. Commit,
 * restore, and revert stay app-mediated through the approval/IPC path so an agent
 * can never wipe uncommitted work. These run against the workspace vault dir,
 * resolved per-document via `getWorkspaceVaultDir` inside the db-aware glue.
 */

/** Render a commit list as a compact, agent-readable table. */
function formatLog(entries: GitLogEntry[]): string {
  if (entries.length === 0) {
    return 'No commits found. The workspace may have no version history yet, or the note has not been committed.'
  }
  const lines = entries.map((e) => {
    const shortOid = e.oid.slice(0, 8)
    const when = new Date(e.timestamp).toISOString()
    const firstLine = e.message.split('\n')[0]
    return `${shortOid}  ${when}  ${e.authorName} <${e.authorEmail}>  ${firstLine}`
  })
  return lines.join('\n')
}

export function createNotesGitTools(db: Database.Database, workspaceId?: string): ToolDefinition[] {
  const notesGitLogTool: ToolDefinition = {
    name: 'notes_git_log',
    label: 'Git Log',
    description:
      'List version-history commits for the workspace, newest first. Provide document_id to see only the commits that touched that note; omit it to see the whole-vault checkpoint history. Each row is: short commit id, ISO timestamp, author (the agent identity marks changes the AI made), and the commit message. Use the commit ids with notes_git_diff / notes_git_show.',
    parameters: Type.Object({
      document_id: Type.Optional(
        Type.String({
          description: 'A note ID to scope the log to commits touching that note. Omit for whole-vault history.'
        })
      )
    }),
    async execute(_toolCallId, params) {
      const p = params as { document_id?: string }
      let entries: GitLogEntry[]
      if (p.document_id) {
        entries = await logDocumentHistory(db, p.document_id)
      } else {
        if (!workspaceId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: No workspace context' }],
            details: undefined
          }
        }
        entries = await logWorkspaceHistory(db, workspaceId)
      }
      return {
        content: [{ type: 'text' as const, text: formatLog(entries) }],
        details: undefined
      }
    }
  }

  const notesGitShowTool: ToolDefinition = {
    name: 'notes_git_show',
    label: 'Git Show',
    description:
      'Show the full content of a note as it was at a specific commit. Provide document_id and the commit ref (a commit id from notes_git_log, or HEAD for the latest committed state). Returns the file content at that revision, or a note that the file did not exist there.',
    parameters: Type.Object({
      document_id: Type.String({ description: 'The note ID to show' }),
      ref: Type.String({ description: 'A commit id (from notes_git_log) or HEAD' })
    }),
    async execute(_toolCallId, params) {
      const p = params as { document_id: string; ref: string }
      const content = await showDocumentAtRef(db, p.document_id, p.ref)
      if (content === null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `The note did not exist at commit ${p.ref}, or the note id / commit is unknown.`
            }
          ],
          details: undefined
        }
      }
      return {
        content: [{ type: 'text' as const, text: content }],
        details: undefined
      }
    }
  }

  const notesGitDiffTool: ToolDefinition = {
    name: 'notes_git_diff',
    label: 'Git Diff',
    description:
      "Show a unified diff of a note between revisions. Provide document_id and a from_ref (a commit id from notes_git_log, or HEAD). By default the note is diffed against its CURRENT on-disk state; pass to_ref to diff between two specific commits instead. Useful for 'what changed in this note since last week' or 'diff this note vs the version before the agent edited it'.",
    parameters: Type.Object({
      document_id: Type.String({ description: 'The note ID to diff' }),
      from_ref: Type.String({ description: 'The older commit id (or HEAD) to diff from' }),
      to_ref: Type.Optional(
        Type.String({
          description:
            'The newer commit id to diff to. Omit to diff from_ref against the current working-tree content.'
        })
      )
    }),
    async execute(_toolCallId, params) {
      const p = params as { document_id: string; from_ref: string; to_ref?: string }
      const patch = await diffDocument(db, p.document_id, p.from_ref, p.to_ref)
      if (!patch.trim()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No differences (the note is unchanged between those revisions), or the note id / commit is unknown.'
            }
          ],
          details: undefined
        }
      }
      return {
        content: [{ type: 'text' as const, text: patch }],
        details: undefined
      }
    }
  }

  return [notesGitLogTool, notesGitShowTool, notesGitDiffTool]
}
