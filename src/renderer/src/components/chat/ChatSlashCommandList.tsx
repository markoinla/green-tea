import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { Zap } from 'lucide-react'
import type { ChatSlashCommandItem } from './chat-slash-commands'

interface ChatSlashCommandListProps {
  items: ChatSlashCommandItem[]
  command: (item: ChatSlashCommandItem) => void
}

export interface ChatSlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const ChatSlashCommandList = forwardRef<ChatSlashCommandListRef, ChatSlashCommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          const item = items[selectedIndex]
          if (item) {
            command(item)
          }
          return true
        }
        return false
      }
    }))

    if (items.length === 0) {
      return (
        <div className="bg-popover border border-border rounded-lg shadow-lg p-2 text-xs text-muted-foreground">
          No skills found
        </div>
      )
    }

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden py-1 w-56">
        {items.map((item, index) => {
          const Icon = Zap
          return (
            <button
              key={item.title}
              onClick={() => command(item)}
              className={`flex items-center gap-2.5 w-full px-3 py-1.5 cursor-pointer text-sm text-left transition-colors ${
                index === selectedIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-muted'
              }`}
            >
              <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-foreground font-medium truncate">{item.title}</span>
            </button>
          )
        })}
      </div>
    )
  }
)

ChatSlashCommandList.displayName = 'ChatSlashCommandList'

export function renderChatSlashSuggestion(onActiveChange: (active: boolean) => void) {
  let component: ReactRenderer<ChatSlashCommandListRef> | null = null
  let popup: HTMLDivElement | null = null

  return {
    onStart: (props: SuggestionProps<ChatSlashCommandItem>) => {
      onActiveChange(true)

      component = new ReactRenderer(ChatSlashCommandList, {
        props,
        editor: props.editor
      })

      popup = document.createElement('div')
      popup.style.position = 'fixed'
      popup.style.zIndex = '50'
      document.body.appendChild(popup)
      popup.appendChild(component.element)

      const rect = props.clientRect?.()
      if (rect && popup) {
        popup.style.left = `${rect.left}px`
        popup.style.top = `${rect.top - popup.offsetHeight}px`
      }
    },

    onUpdate: (props: SuggestionProps<ChatSlashCommandItem>) => {
      component?.updateProps(props)

      const rect = props.clientRect?.()
      if (rect && popup) {
        popup.style.left = `${rect.left}px`
        popup.style.top = `${rect.top - popup.offsetHeight}px`
      }
    },

    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === 'Escape') {
        popup?.remove()
        component?.destroy()
        popup = null
        component = null
        onActiveChange(false)
        return true
      }
      return component?.ref?.onKeyDown(props) ?? false
    },

    onExit: () => {
      popup?.remove()
      component?.destroy()
      popup = null
      component = null
      onActiveChange(false)
    }
  }
}
