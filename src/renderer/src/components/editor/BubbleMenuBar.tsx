import { useState, useCallback } from 'react'
import { type Editor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { NodeSelection } from '@tiptap/pm/state'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Highlighter,
  Link,
  Unlink,
  Heading1,
  Heading2,
  Heading3,
  TextQuote,
  List,
  ListOrdered,
  ListTodo,
  MessageSquareQuote
} from 'lucide-react'

interface BubbleMenuBarProps {
  editor: Editor | null
  onQuoteSelection?: (text: string) => void
}

const IMAGE_SIZE_OPTIONS = [
  { label: '25%', value: '25%' },
  { label: '50%', value: '50%' },
  { label: '75%', value: '75%' },
  { label: '100%', value: '100%' }
]

function BubbleButton({
  onClick,
  active,
  children,
  title
}: {
  onClick: () => void
  active?: boolean
  children: React.ReactNode
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

function BubbleSeparator() {
  return <div className="w-px h-5 bg-border mx-0.5" />
}

function LinkInput({
  initialUrl,
  onSubmit,
  onRemove,
  onCancel
}: {
  initialUrl: string
  onSubmit: (url: string) => void
  onRemove: () => void
  onCancel: () => void
}) {
  const [url, setUrl] = useState(initialUrl)

  return (
    <div className="flex items-center gap-1 px-1">
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit(url)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        placeholder="Paste link..."
        className="bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground w-48"
        autoFocus
      />
      {initialUrl && (
        <BubbleButton onClick={onRemove} title="Remove link">
          <Unlink className="h-5 w-5" />
        </BubbleButton>
      )}
    </div>
  )
}

const ICON_SIZE = 'h-5 w-5'

export function BubbleMenuBar({ editor, onQuoteSelection }: BubbleMenuBarProps) {
  const [showLinkInput, setShowLinkInput] = useState(false)

  const editorState = useEditorState({
    editor,
    selector: (ctx) => {
      if (!ctx.editor) return null
      const e = ctx.editor
      const { selection } = e.state
      const isImageSelected =
        selection instanceof NodeSelection && selection.node.type.name === 'image'
      const isTextSelected = !selection.empty && !(selection instanceof NodeSelection)

      return {
        isImageSelected,
        isTextSelected,
        imageWidth: isImageSelected ? (e.getAttributes('image').width as string) || null : null,
        h1: e.isActive('heading', { level: 1 }),
        h2: e.isActive('heading', { level: 2 }),
        h3: e.isActive('heading', { level: 3 }),
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        highlight: e.isActive('highlight'),
        link: e.isActive('link'),
        blockquote: e.isActive('blockquote'),
        bulletList: e.isActive('outlinerList'),
        orderedList: e.isActive('outlinerOrderedList'),
        taskList: e.isActive('taskList'),
        linkHref: (e.getAttributes('link').href as string) || ''
      }
    }
  })

  const setLink = useCallback(
    (url: string) => {
      if (!editor) return
      if (!url) {
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      }
      setShowLinkInput(false)
    },
    [editor]
  )

  const removeLink = useCallback(() => {
    if (!editor) return
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    setShowLinkInput(false)
  }, [editor])

  const shouldShow = useCallback(({ editor: e }: { editor: Editor }) => {
    const { selection } = e.state
    if (selection.empty) return false

    // Hide for cell selections (multi-cell drag) — table ops handled by dropdown
    if ('$anchorCell' in selection) return false

    // Show for image node selections
    if (selection instanceof NodeSelection) {
      return selection.node.type.name === 'image'
    }
    // Show for text selections
    return true
  }, [])

  if (!editor || !editorState) return null

  return (
    <BubbleMenu editor={editor} pluginKey="bubbleMenu" shouldShow={shouldShow}>
      {editorState.isImageSelected ? (
        <div className="flex items-center gap-1 bg-popover border border-border rounded-lg shadow-lg px-1.5 py-1">
          {IMAGE_SIZE_OPTIONS.map((option) => {
            const isActive =
              editorState.imageWidth === option.value ||
              (!editorState.imageWidth && option.value === '100%')

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
      ) : (
        <div className="flex items-center gap-0.5 bg-popover border border-border rounded-lg shadow-lg px-1 py-1">
          {showLinkInput ? (
            <LinkInput
              initialUrl={editorState.linkHref}
              onSubmit={setLink}
              onRemove={removeLink}
              onCancel={() => setShowLinkInput(false)}
            />
          ) : (
            <>
              {/* Headings */}
              <BubbleButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                active={editorState.h1}
                title="Heading 1"
              >
                <Heading1 className={ICON_SIZE} />
              </BubbleButton>
              <BubbleButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                active={editorState.h2}
                title="Heading 2"
              >
                <Heading2 className={ICON_SIZE} />
              </BubbleButton>
              <BubbleButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                active={editorState.h3}
                title="Heading 3"
              >
                <Heading3 className={ICON_SIZE} />
              </BubbleButton>

              <BubbleSeparator />

              {/* Inline formatting */}
              <BubbleButton
                onClick={() => editor.chain().focus().toggleBold().run()}
                active={editorState.bold}
                title="Bold (Ctrl+B)"
              >
                <Bold className={ICON_SIZE} />
              </BubbleButton>
              <BubbleButton
                onClick={() => editor.chain().focus().toggleItalic().run()}
                active={editorState.italic}
                title="Italic (Ctrl+I)"
              >
                <Italic className={ICON_SIZE} />
              </BubbleButton>
              <BubbleButton
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                active={editorState.underline}
                title="Underline (Ctrl+U)"
              >
                <Underline className={ICON_SIZE} />
              </BubbleButton>
              <BubbleButton
                onClick={() => editor.chain().focus().toggleStrike().run()}
                active={editorState.strike}
                title="Strikethrough (Ctrl+Shift+S)"
              >
                <Strikethrough className={ICON_SIZE} />
              </BubbleButton>
              <BubbleButton
                onClick={() => editor.chain().focus().toggleCode().run()}
                active={editorState.code}
                title="Inline Code (Ctrl+E)"
              >
                <Code className={ICON_SIZE} />
              </BubbleButton>
              <BubbleButton
                onClick={() => editor.chain().focus().toggleHighlight().run()}
                active={editorState.highlight}
                title="Highlight"
              >
                <Highlighter className={ICON_SIZE} />
              </BubbleButton>

              <BubbleSeparator />

              {/* Link */}
              <BubbleButton
                onClick={() => setShowLinkInput(true)}
                active={editorState.link}
                title="Link"
              >
                <Link className={ICON_SIZE} />
              </BubbleButton>

              {/* Block conversions */}
              <BubbleButton
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                active={editorState.blockquote}
                title="Blockquote"
              >
                <TextQuote className={ICON_SIZE} />
              </BubbleButton>
              <BubbleButton
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                active={editorState.bulletList}
                title="Bullet List"
              >
                <List className={ICON_SIZE} />
              </BubbleButton>
              <BubbleButton
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                active={editorState.orderedList}
                title="Ordered List"
              >
                <ListOrdered className={ICON_SIZE} />
              </BubbleButton>
              <BubbleButton
                onClick={() => editor.chain().focus().toggleTaskList().run()}
                active={editorState.taskList}
                title="Task List"
              >
                <ListTodo className={ICON_SIZE} />
              </BubbleButton>

              {/* Quote to chat */}
              {onQuoteSelection && (
                <>
                  <BubbleSeparator />
                  <BubbleButton
                    onClick={() => {
                      const { from, to } = editor.state.selection
                      const text = editor.state.doc.textBetween(from, to, ' ')
                      if (text.trim()) {
                        onQuoteSelection(text)
                      }
                    }}
                    title="Quote to chat"
                  >
                    <MessageSquareQuote className={ICON_SIZE} />
                  </BubbleButton>
                </>
              )}
            </>
          )}
        </div>
      )}
    </BubbleMenu>
  )
}
