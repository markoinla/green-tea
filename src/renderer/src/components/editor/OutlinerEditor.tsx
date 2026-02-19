import { useEffect, useRef } from 'react'
import { useEditor, EditorContent, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import { createLowlight } from 'lowlight'

import { OutlinerList, OutlinerOrderedList, OutlinerItem } from './extensions/outliner-node'
import { OutlinerKeymap } from './extensions/outliner-keymap'
import { Collapsible } from './extensions/collapsible'
import { SlashCommands } from './extensions/slash-commands'
import { ImageUpload } from './extensions/image-upload'
import { SearchAndReplace } from './extensions/search-and-replace'
import { ChangeHighlight } from './extensions/change-highlight'
import { TableCellMenu } from './extensions/table-cell-menu'
import { BubbleMenuBar } from './BubbleMenuBar'
import { TableCellDropdownMenu } from './TableCellDropdownMenu'
import { TableContextMenu } from './TableContextMenu'
import { SearchBar } from './SearchBar'
import { renderSlashSuggestion } from './SlashCommandList'

const lowlight = createLowlight()

interface OutlinerEditorProps {
  content?: JSONContent
  onUpdate?: (content: JSONContent) => void
  focusBlockId?: string
  editable?: boolean
  onQuoteSelection?: (text: string) => void
  /** Parsed content from an external update (e.g. agent patch). */
  externalContent?: JSONContent | null
  /** Incremented each time external content arrives. */
  externalContentVersion?: number
}

export function OutlinerEditor({
  content,
  onUpdate,
  focusBlockId: _focusBlockId, // eslint-disable-line @typescript-eslint/no-unused-vars
  editable = true,
  onQuoteSelection,
  externalContent,
  externalContentVersion = 0
}: OutlinerEditorProps) {
  const prevExternalVersionRef = useRef(externalContentVersion)

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        codeBlock: false
      }),
      OutlinerList,
      OutlinerOrderedList,
      OutlinerItem,
      OutlinerKeymap,
      Collapsible,
      Placeholder.configure({
        placeholder: 'Type something...'
      }),
      TaskList,
      TaskItem.configure({
        nested: true
      }),
      CodeBlockLowlight.configure({
        lowlight
      }),
      TableKit.configure({
        table: {
          resizable: true,
          cellMinWidth: 100
        }
      }),
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            width: {
              default: null,
              parseHTML: (element) => element.style.width || null,
              renderHTML: (attributes) => {
                if (!attributes.width) return {}
                return { style: `width: ${attributes.width}` }
              }
            }
          }
        }
      }).configure({
        inline: false,
        allowBase64: false
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline cursor-pointer'
        }
      }),
      Highlight.configure({
        HTMLAttributes: {
          class: 'bg-yellow-200 dark:bg-yellow-800/50'
        }
      }),
      Underline,
      ImageUpload,
      SearchAndReplace,
      ChangeHighlight,
      TableCellMenu,
      SlashCommands.configure({
        suggestion: {
          render: renderSlashSuggestion
        }
      })
    ],
    content: content ?? {
      type: 'doc',
      content: [{ type: 'paragraph' }]
    },
    onUpdate: ({ editor: e }) => {
      onUpdate?.(e.getJSON())
    }
  })

  // Apply external content in-place (e.g. agent patches) without remounting.
  useEffect(() => {
    if (externalContentVersion === prevExternalVersionRef.current) return
    prevExternalVersionRef.current = externalContentVersion
    if (!editor || !externalContent) return

    // Find the scroll container and remember its position.
    const scrollEl = editor.view.dom.closest('.overflow-auto')
    const scrollTop = scrollEl?.scrollTop ?? 0

    // Snapshot old node text content by index for diffing.
    const oldTexts: string[] = []
    editor.state.doc.forEach((node) => {
      oldTexts.push(node.textContent)
    })

    editor.commands.setContent(externalContent, { emitUpdate: false })

    // Diff new content against old by index to find changed top-level nodes.
    const changedPositions: number[] = []
    let index = 0
    editor.state.doc.forEach((node, offset) => {
      if (index >= oldTexts.length || oldTexts[index] !== node.textContent) {
        changedPositions.push(offset)
      }
      index++
    })

    if (changedPositions.length > 0) {
      editor.commands.highlightChanges(changedPositions)
    }

    // Restore scroll position on the next frame.
    if (scrollEl) {
      requestAnimationFrame(() => {
        scrollEl.scrollTop = scrollTop
      })
    }
  }, [editor, externalContent, externalContentVersion])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SearchBar editor={editor} />
      <div className="flex-1 min-h-0 overflow-auto">
        <TableContextMenu editor={editor}>
          <EditorContent editor={editor} />
        </TableContextMenu>
        <BubbleMenuBar editor={editor} onQuoteSelection={onQuoteSelection} />
        <TableCellDropdownMenu editor={editor} />
      </div>
    </div>
  )
}
