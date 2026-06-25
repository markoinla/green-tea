import type { MetadataEditItem } from '@renderer/hooks/chat-types'

interface MetadataApprovalProps {
  logId: string
  payload: MetadataEditItem[]
  resolveDocName: (id: string) => string
  onApprove: (logId: string) => void
  onReject: (logId: string) => void
}

/** Render a single property value for the key/value table (arrays comma-joined). */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '(cleared)'
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  return String(value)
}

/**
 * Non-diff approval card for a batched metadata proposal (Phase 5, H1). Unlike
 * PatchApproval (which renders a unified diff), this shows a key/value table of
 * the proposed property changes across every affected note.
 */
export function MetadataApproval({
  logId,
  payload,
  resolveDocName,
  onApprove,
  onReject
}: MetadataApprovalProps) {
  return (
    <div className="my-2 ml-9 rounded-xl border border-border overflow-hidden">
      <div className="px-3 py-1.5 bg-muted">
        <span className="text-xs font-medium text-muted-foreground">
          Proposed Metadata ({payload.length} note{payload.length === 1 ? '' : 's'})
        </span>
      </div>

      <div className="max-h-48 overflow-y-auto divide-y divide-border">
        {payload.map((edit, i) => (
          <div key={`${edit.document_id}-${i}`} className="px-3 py-2">
            <div className="text-xs font-medium text-foreground mb-1 truncate">
              {resolveDocName(edit.document_id)}
            </div>
            <table className="w-full text-xs">
              <tbody>
                {Object.keys(edit.changedKeys).map((key) => (
                  <tr key={key}>
                    <td className="pr-3 py-0.5 align-top text-muted-foreground whitespace-nowrap">
                      {key}
                    </td>
                    <td className="py-0.5 text-foreground break-words">
                      {formatValue(edit.changedKeys[key])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
        <button
          type="button"
          onClick={() => onApprove(logId)}
          className="flex-1 text-xs px-3 py-1.5 rounded-lg bg-accent text-accent-foreground font-medium hover:opacity-90 transition-opacity"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => onReject(logId)}
          className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:border-destructive hover:text-destructive transition-colors"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
