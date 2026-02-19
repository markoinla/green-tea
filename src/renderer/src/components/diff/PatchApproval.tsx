import { DiffPreview } from './DiffPreview'

interface PatchApprovalProps {
  logId: string
  diff: string
  onApprove: (logId: string) => void
  onReject: (logId: string) => void
}

export function PatchApproval({ logId, diff, onApprove, onReject }: PatchApprovalProps) {
  return (
    <div className="my-2 ml-9 rounded-xl border border-border overflow-hidden">
      <div className="px-3 py-1.5 bg-muted">
        <span className="text-xs font-medium text-muted-foreground">Proposed Changes</span>
      </div>

      <div className="max-h-48 overflow-y-auto">
        <DiffPreview diff={diff} />
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
