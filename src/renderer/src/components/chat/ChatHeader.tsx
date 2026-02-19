import {
  MessageSquare,
  Square,
  RotateCcw,
  ChevronDown,
  Plus,
  X as XIcon,
  Settings2
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@renderer/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { formatTokenCount } from '@renderer/hooks/chat-types'
import { PROVIDERS, isModelEnabled } from '@renderer/lib/models'
import type { Settings } from '@renderer/hooks/useSettings'
import type { Conversation } from '../../../../main/database/types'

interface ChatHeaderProps {
  conversations: Conversation[]
  activeConversationId: string | null
  canCreateNew: boolean
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
  onNewConversation: () => void
  settings: Settings
  onUpdateSetting: (key: keyof Settings, value: string | boolean) => void
  tokens?: { input: number; output: number; total: number }
  isStreaming: boolean
  hasMessages: boolean
  onStop: () => void
  onClear: () => void
  documentId: string | null
}

export function ChatHeader({
  conversations,
  activeConversationId,
  canCreateNew,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
  settings,
  onUpdateSetting,
  tokens,
  isStreaming,
  hasMessages,
  onStop,
  onClear,
  documentId
}: ChatHeaderProps) {
  return (
    <div className={cn('py-3 border-b border-border/40', documentId ? 'px-3' : 'px-48')}>
      {/* Tab bar */}
      <div className="flex items-center gap-1.5 mb-2 min-h-[28px]">
        <TooltipProvider delayDuration={1000}>
          {conversations.map((conv) => (
            <Tooltip key={conv.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelectConversation(conv.id)}
                  className={cn(
                    'group relative flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-all max-w-[140px]',
                    conv.id === activeConversationId
                      ? 'bg-muted text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <span className="truncate">{conv.title || 'New chat'}</span>
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteConversation(conv.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 h-4 w-4 rounded flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-opacity flex-shrink-0"
                  >
                    <XIcon className="h-2.5 w-2.5" />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{conv.title || 'New chat'}</TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
        {canCreateNew && (
          <button
            onClick={onNewConversation}
            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 transition-colors flex-shrink-0"
            title="New conversation"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Model selector row */}
      <div className="flex items-center justify-between">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-foreground transition-colors outline-none px-2 py-1.5 rounded-md hover:bg-muted/50">
              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
              {settings.aiProvider === 'default'
                ? 'Green Tea'
                : (settings.aiProvider === 'anthropic'
                    ? settings.anthropicModel
                    : settings.aiProvider === 'openrouter'
                      ? settings.openrouterModel
                      : settings.togetherModel
                  )
                    .split('/')
                    .pop()}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={settings.aiProvider === 'default' ? 'default' : ''}
              onValueChange={() => {
                onUpdateSetting('aiProvider', 'default')
              }}
            >
              <DropdownMenuRadioItem value="default">Green Tea</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {PROVIDERS.filter((p) => p.id !== 'default').map((provider) => {
              const keyField = provider.keyField as keyof Settings
              const hasKey = !!(settings[keyField] as string)
              const modelField = provider.modelField as keyof Settings
              const enabledModels = provider.models.filter(
                (m) => hasKey && isModelEnabled(settings.enabledModels, m.id)
              )
              if (enabledModels.length === 0) return null
              return (
                <div key={provider.id}>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{provider.name}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={
                      settings.aiProvider === provider.id ? (settings[modelField] as string) : ''
                    }
                    onValueChange={(value) => {
                      onUpdateSetting('aiProvider', provider.id)
                      onUpdateSetting(modelField, value)
                    }}
                  >
                    {enabledModels.map((model) => (
                      <DropdownMenuRadioItem key={model.id} value={model.id}>
                        {model.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </div>
              )
            })}
            <DropdownMenuSeparator />
            <button
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'models' }))
              }}
            >
              <Settings2 className="h-3 w-3" />
              Model settings
            </button>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-1">
          {tokens && tokens.total > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs tabular-nums text-muted-foreground/70 cursor-default rounded-lg bg-muted/40 border border-border/50 px-2 py-0.5">
                    {formatTokenCount(tokens.total)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="flex flex-col gap-0.5 text-xs">
                    <span>In: {formatTokenCount(tokens.input)}</span>
                    <span>Out: {formatTokenCount(tokens.output)}</span>
                    <span className="border-t border-background/20 pt-0.5">
                      Total: {formatTokenCount(tokens.total)}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isStreaming ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </button>
          ) : (
            hasMessages && (
              <button
                onClick={onClear}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Clear chat"
              >
                <RotateCcw className="h-3 w-3" />
                Clear
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
