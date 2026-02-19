import {
  ArrowUp,
  AtSign,
  Paperclip,
  Sparkles,
  Brain,
  Zap,
  Check,
  Eye,
  Mic,
  Loader2
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { MAX_ATTACHMENTS } from './chat-input-constants'

interface ChatInputToolbarProps {
  disabled: boolean
  showSlashCommands: boolean
  reasoningMode: boolean
  autoApproveEdits: boolean
  totalAttachments: number
  canSend: boolean
  speechError: string | null
  speechStatus: 'idle' | 'connecting' | 'recording' | 'error'
  onMentionTrigger: () => void
  onSkillTrigger: () => void
  onFilePick: () => void
  onToggleReasoning?: () => void
  onToggleAutoApprove?: () => void
  onMicToggle: () => void
  onSend: () => void
}

export function ChatInputToolbar({
  disabled,
  showSlashCommands,
  reasoningMode,
  autoApproveEdits,
  totalAttachments,
  canSend,
  speechError,
  speechStatus,
  onMentionTrigger,
  onSkillTrigger,
  onFilePick,
  onToggleReasoning,
  onToggleAutoApprove,
  onMicToggle,
  onSend
}: ChatInputToolbarProps) {
  return (
    <div className="flex items-center justify-between px-2 pb-2">
      <div className="flex items-center gap-1 pl-1">
        <button
          type="button"
          onClick={onMentionTrigger}
          disabled={disabled}
          className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-background/50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          title="Mention a document"
        >
          <AtSign className="h-4 w-4" />
        </button>
        {showSlashCommands && (
          <button
            type="button"
            onClick={onSkillTrigger}
            disabled={disabled}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-background/50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            title="Use a skill"
          >
            <Sparkles className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onFilePick}
          disabled={disabled || totalAttachments >= MAX_ATTACHMENTS}
          className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-background/50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          title="Attach file"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleReasoning}
          disabled={disabled}
          className={cn(
            'h-7 rounded-lg flex items-center justify-center gap-1 px-1.5 transition-colors disabled:opacity-50 disabled:pointer-events-none',
            reasoningMode
              ? 'text-primary bg-primary/10 hover:bg-primary/15'
              : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-background/50'
          )}
          title={
            reasoningMode
              ? 'Thinking mode (click to switch to instant)'
              : 'Instant mode (click to switch to thinking)'
          }
        >
          {reasoningMode ? <Brain className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
          <span className="text-[10px] font-medium">{reasoningMode ? 'Think' : 'Fast'}</span>
        </button>
        <button
          type="button"
          onClick={onToggleAutoApprove}
          disabled={disabled}
          className={cn(
            'h-7 rounded-lg flex items-center justify-center gap-1 px-1.5 transition-colors disabled:opacity-50 disabled:pointer-events-none',
            autoApproveEdits
              ? 'text-primary bg-primary/10 hover:bg-primary/15'
              : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-background/50'
          )}
          title={
            autoApproveEdits
              ? 'Auto-approve edits (click for manual review)'
              : 'Manual review (click for auto-approve)'
          }
        >
          {autoApproveEdits ? <Check className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          <span className="text-[10px] font-medium">{autoApproveEdits ? 'Auto' : 'Review'}</span>
        </button>
      </div>
      <div className="flex items-center gap-1.5 ml-auto">
        {speechError && (
          <span className="text-[10px] text-destructive mr-0.5" title={speechError}>
            {speechError}
          </span>
        )}
        <button
          type="button"
          onClick={onMicToggle}
          disabled={disabled}
          className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 shadow-sm disabled:opacity-50 disabled:pointer-events-none',
            speechStatus === 'recording'
              ? 'bg-emerald-500 text-white hover:opacity-90 hover:scale-105 active:scale-95'
              : speechStatus === 'connecting'
                ? 'bg-muted-foreground/10 text-muted-foreground/30 cursor-wait'
                : 'bg-muted-foreground/10 text-muted-foreground/30 hover:bg-muted-foreground/15 hover:text-muted-foreground/50'
          )}
          title={
            speechStatus === 'recording'
              ? 'Stop recording'
              : speechStatus === 'connecting'
                ? 'Connecting...'
                : 'Voice input'
          }
        >
          {speechStatus === 'connecting' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : speechStatus === 'recording' ? (
            <Mic className="h-5 w-5" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200 shadow-sm',
            canSend
              ? 'bg-primary text-primary-foreground hover:opacity-90 hover:scale-105 active:scale-95'
              : 'bg-muted-foreground/10 text-muted-foreground/30 cursor-not-allowed'
          )}
        >
          <ArrowUp className="h-4 w-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  )
}
