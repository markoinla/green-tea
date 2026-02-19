import { useState } from 'react'
import type { Components } from 'react-markdown'
import {
  ChevronRight,
  FileText,
  Search,
  List,
  FileEdit,
  FilePlus,
  Compass,
  Wrench,
  Terminal,
  Eye,
  Pencil,
  FileOutput,
  FolderSearch,
  FolderOpen,
  Globe,
  File,
  Users
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function shortPath(p: unknown): string {
  if (typeof p !== 'string') return ''
  const parts = p.replace(/\\/g, '/').split('/')
  return parts.length > 2 ? parts.slice(-2).join('/') : parts.join('/')
}

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

type LabelFn = (args?: Record<string, unknown>, resolveDoc?: (id: string) => string) => string

const TOOL_META: Record<string, { icon: typeof FileText; label: LabelFn }> = {
  // Notes tools
  notes_list: {
    icon: List,
    label: () => 'Listing notes'
  },
  notes_get_markdown: {
    icon: FileText,
    label: (args, resolveDoc) => {
      const name = resolveDoc?.(String(args?.document_id ?? '')) ?? 'note'
      if (args?.block_id) return `Reading block in ${name}`
      return `Reading ${name}`
    }
  },
  notes_search: {
    icon: Search,
    label: (args) => `Searching for "${args?.query || '...'}"`
  },
  notes_get_outline: {
    icon: Compass,
    label: (args, resolveDoc) => {
      const name = resolveDoc?.(String(args?.document_id ?? '')) ?? 'note'
      return `Outline of ${name}`
    }
  },
  notes_create: {
    icon: FilePlus,
    label: (args) => `Creating "${args?.title || 'note'}"`
  },
  notes_propose_edit: {
    icon: FileEdit,
    label: (args, resolveDoc) => {
      const name = resolveDoc?.(String(args?.document_id ?? '')) ?? 'note'
      return `Proposing changes to ${name}`
    }
  },
  notes_update_workspace_description: {
    icon: FileEdit,
    label: () => 'Updating workspace description'
  },
  // Coding tools
  read: {
    icon: Eye,
    label: (args) => `Reading ${shortPath(args?.path) || 'file'}`
  },
  write: {
    icon: FileOutput,
    label: (args) => `Writing ${shortPath(args?.path) || 'file'}`
  },
  edit: {
    icon: Pencil,
    label: (args) => `Editing ${shortPath(args?.path) || 'file'}`
  },
  bash: {
    icon: Terminal,
    label: (args) => `Running ${truncate(String(args?.command || 'command'), 40)}`
  },
  grep: {
    icon: Search,
    label: (args) => {
      const pattern = args?.pattern || '...'
      const scope = args?.glob || args?.path || ''
      return scope ? `Grep "${pattern}" in ${shortPath(scope)}` : `Grep "${pattern}"`
    }
  },
  find: {
    icon: FolderSearch,
    label: (args) => {
      const pattern = args?.pattern || '...'
      const scope = args?.path ? ` in ${shortPath(args.path)}` : ''
      return `Finding "${pattern}"${scope}`
    }
  },
  ls: {
    icon: FolderOpen,
    label: (args) => `Listing ${shortPath(args?.path) || '.'}`
  },
  web_search: {
    icon: Globe,
    label: (args) => `Searching web for "${args?.query || '...'}"`
  },
  web_fetch: {
    icon: Globe,
    label: (args) => {
      const url = String(args?.url || '')
      if (!url) return 'Fetching web page'
      try {
        const u = new URL(url)
        const display = u.hostname + (u.pathname !== '/' ? u.pathname : '')
        return `Fetching ${truncate(display, 40)}`
      } catch {
        return `Fetching ${truncate(url, 40)}`
      }
    }
  },
  subagent: {
    icon: Users,
    label: (args) => {
      if (args?.agent) {
        const task = String(args?.task || '')
        if (task) return `${args.agent}: ${truncate(task, 35)}`
        return `Running ${args.agent} agent`
      }
      if (args?.tasks) return `Running ${(args.tasks as unknown[]).length} agents in parallel`
      if (args?.chain) return `Running ${(args.chain as unknown[]).length}-step chain`
      return 'Running subagent'
    }
  }
}

export function getToolDescription(
  toolName: string,
  args?: Record<string, unknown>,
  resolveDoc?: (id: string) => string
): string {
  const meta = TOOL_META[toolName]
  if (meta) return meta.label(args, resolveDoc)
  return `Using ${toolName.replace(/_/g, ' ')}`
}

export function getToolIcon(toolName: string) {
  return TOOL_META[toolName]?.icon ?? Wrench
}

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  timestamp?: number
  toolName?: string
  toolArgs?: Record<string, unknown>
  images?: { data: string; mimeType: string }[]
  files?: { name: string }[]
  resolveDocName?: (id: string) => string
}

// Custom link renderer: mention links render as styled chips
const markdownComponents: Components = {
  a: ({ href, children }) => {
    if (href === 'mention') {
      return <span className="mention-chip">{children}</span>
    }
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          if (href) window.open(href, '_blank')
        }}
      >
        {children}
      </a>
    )
  }
}

export function ChatMessage({
  role,
  content,
  thinking,
  toolName,
  toolArgs,
  images,
  files,
  resolveDocName
}: ChatMessageProps) {
  const isUser = role === 'user'
  const [showThinking, setShowThinking] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Render tool call as a compact status line
  if (toolName) {
    const Icon = getToolIcon(toolName)
    const description = getToolDescription(toolName, toolArgs, resolveDocName)
    return (
      <div className="flex items-center gap-2 py-1 px-2">
        <Icon className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
        <span className="text-xs text-muted-foreground/60">{description}</span>
      </div>
    )
  }

  return (
    <div className={`flex py-2.5 overflow-hidden ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] min-w-0 text-sm leading-relaxed ${
          isUser
            ? 'bg-muted rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-foreground'
            : 'text-foreground'
        }`}
      >
        {thinking && (
          <button
            onClick={() => setShowThinking(!showThinking)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1 transition-colors"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${showThinking ? 'rotate-90' : ''}`}
            />
            Thinking...
          </button>
        )}
        {showThinking && thinking && (
          <div className="text-xs text-muted-foreground/70 mb-2 pl-3 border-l-2 border-accent/50 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
            {thinking}
          </div>
        )}
        {content && (
          <div className="prose-chat break-words">
            {isUser && content.length > 500 ? (
              expanded ? (
                <>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {content}
                  </ReactMarkdown>
                  <button
                    onClick={() => setExpanded(false)}
                    className="text-xs text-muted-foreground hover:text-foreground mt-1 transition-colors"
                  >
                    Show less
                  </button>
                </>
              ) : (
                <>
                  <span className="whitespace-pre-wrap">{content.slice(0, 200)}…</span>
                  <button
                    onClick={() => setExpanded(true)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-1.5 transition-colors"
                  >
                    Show more ·{' '}
                    {content.length >= 1000
                      ? `${(content.length / 1000).toFixed(1)}K`
                      : content.length}{' '}
                    chars
                  </button>
                </>
              )
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {content}
              </ReactMarkdown>
            )}
          </div>
        )}
        {images && images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {images.map((img, i) => (
              <img
                key={i}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt={`Attachment ${i + 1}`}
                className="h-20 w-20 rounded-lg object-cover border border-border/30"
              />
            ))}
          </div>
        )}
        {files && files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {files.map((file, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 border border-border/30 text-xs text-muted-foreground"
              >
                <File className="h-3 w-3 flex-shrink-0" />
                {file.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
