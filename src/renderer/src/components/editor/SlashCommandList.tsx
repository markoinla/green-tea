import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import type { SlashCommandItem } from './extensions/slash-commands'

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const SlashCommandList = forwardRef<SlashCommandListRef, SlashCommandListProps>(
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
          No commands found
        </div>
      )
    }

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden py-1 w-56">
        {items.map((item, index) => (
          <button
            key={item.title}
            onClick={() => command(item)}
            className={`flex items-center gap-2.5 w-full px-3 py-1.5 cursor-pointer text-sm text-left transition-colors ${
              index === selectedIndex
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="text-foreground font-medium">{item.title}</span>
              <span className="text-muted-foreground text-xs">{item.description}</span>
            </div>
          </button>
        ))}
      </div>
    )
  }
)

SlashCommandList.displayName = 'SlashCommandList'

export function renderSlashSuggestion() {
  let component: ReactRenderer<SlashCommandListRef> | null = null
  let popup: HTMLDivElement | null = null

  return {
    onStart: (props: SuggestionProps<SlashCommandItem>) => {
      component = new ReactRenderer(SlashCommandList, {
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
        popup.style.top = `${rect.bottom + 4}px`
      }
    },

    onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
      component?.updateProps(props)

      const rect = props.clientRect?.()
      if (rect && popup) {
        popup.style.left = `${rect.left}px`
        popup.style.top = `${rect.bottom + 4}px`
      }
    },

    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === 'Escape') {
        popup?.remove()
        component?.destroy()
        popup = null
        component = null
        return true
      }
      return component?.ref?.onKeyDown(props) ?? false
    },

    onExit: () => {
      popup?.remove()
      component?.destroy()
      popup = null
      component = null
    }
  }
}
