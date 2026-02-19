import { useCallback } from 'react'
import { type Editor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'

interface ImageBubbleMenuProps {
  editor: Editor | null
}

const SIZE_OPTIONS = [
  { label: '25%', value: '25%' },
  { label: '50%', value: '50%' },
  { label: '75%', value: '75%' },
  { label: '100%', value: '100%' }
]

export function ImageBubbleMenu({ editor }: ImageBubbleMenuProps) {
  const currentWidth = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) return null
      return (ctx.editor.getAttributes('image').width as string) || null
    }
  })

  const shouldShow = useCallback(({ editor: e }: { editor: Editor }) => {
    const { selection } = e.state
    if (!(selection instanceof NodeSelection)) return false
    return selection.node.type.name === 'image'
  }, [])

  if (!editor) return null

  return (
    <BubbleMenu editor={editor} pluginKey="imageBubbleMenu" shouldShow={shouldShow} updateDelay={0}>
      <div className="flex items-center gap-1 bg-popover border border-border rounded-lg shadow-lg px-1.5 py-1">
        {SIZE_OPTIONS.map((option) => {
          const isActive =
            currentWidth === option.value || (!currentWidth && option.value === '100%')

          return (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                editor.chain().focus().updateAttributes('image', { width: option.value }).run()
              }
              className={`px-2.5 py-1 text-sm rounded-md transition-colors ${
                isActive
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </BubbleMenu>
  )
}
