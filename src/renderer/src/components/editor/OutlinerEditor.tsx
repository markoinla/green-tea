import { useEffect, useRef } from 'react'
import { useEditor, EditorContent, type JSONContent, type Editor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
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
import { WikiLink } from './extensions/wiki-link'
import { ImageUpload } from './extensions/image-upload'
import { SearchAndReplace } from './extensions/search-and-replace'
import { ChangeHighlight } from './extensions/change-highlight'
import { TableCellMenu } from './extensions/table-cell-menu'
import { BubbleMenuBar } from './BubbleMenuBar'
import { TableCellDropdownMenu } from './TableCellDropdownMenu'
import { TableContextMenu } from './TableContextMenu'
import { SearchBar } from './SearchBar'
import { renderSlashSuggestion } from './SlashCommandList'
import { renderWikiLinkSuggestion } from './WikiLinkList'
import { collectHeadings, headingSlug } from './heading-anchors'
import { DocumentTitle } from './DocumentTitle'
import { NoteFacetBar } from './NoteFacetBar'
import { cn } from '@renderer/lib/utils'
import type { Document } from '../../../../main/database/types'

const lowlight = createLowlight()

// Scroll the editor to the first heading whose slug matches `anchor` (a
// same-note `[[#Heading]]` link). No-op when nothing matches, so a stale anchor
// simply does nothing.
function scrollToHeadingInView(view: EditorView, anchor: string): void {
  const slug = headingSlug(anchor)
  const match = collectHeadings(view.state.doc).find((h) => headingSlug(h.text) === slug)
  if (!match) return
  const dom = view.nodeDOM(match.pos)
  const el = dom instanceof HTMLElement ? dom : ((dom as ChildNode | null)?.parentElement ?? null)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

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
  /** The backing document; when present, the inline Properties editor is shown. */
  document?: Document | null
  /** Navigate to a document when a resolved wiki-link is clicked. */
  onNavigateToDoc?: (docId: string, opts?: { newTab?: boolean }) => void
  /** Back/forward through the global view history, surfaced in the facet bar. */
  onNavigateBack?: () => void
  onNavigateForward?: () => void
  canNavigateBack?: boolean
  canNavigateForward?: boolean
}

export function OutlinerEditor({
  content,
  onUpdate,
  focusBlockId: _focusBlockId, // eslint-disable-line @typescript-eslint/no-unused-vars
  editable = true,
  onQuoteSelection,
  externalContent,
  externalContentVersion = 0,
  document = null,
  onNavigateToDoc,
  onNavigateBack,
  onNavigateForward,
  canNavigateBack,
  canNavigateForward
}: OutlinerEditorProps) {
  const prevExternalVersionRef = useRef(externalContentVersion)

  // The editor is created once; keep the latest navigate callback in a ref so
  // the handleClickOn closure below always sees the current prop.
  const onNavigateToDocRef = useRef(onNavigateToDoc)
  onNavigateToDocRef.current = onNavigateToDoc

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
      }),
      WikiLink.configure({
        suggestion: {
          items: async ({ query, editor: e }: { query: string; editor: Editor }) => {
            // `[[#frag` lists headings in the CURRENT note (same-note anchor).
            if (query.startsWith('#')) {
              const frag = headingSlug(query.slice(1))
              return collectHeadings(e.state.doc)
                .filter((h) => h.text && (frag === '' || headingSlug(h.text).includes(frag)))
                .slice(0, 8)
                .map((h) => ({ id: null, label: '', anchor: h.text }))
            }
            const docs = (await window.api.documents.search(query)) as Array<{
              id: string
              title: string
              workspace_id: string
            }>
            return docs.slice(0, 8).map((d) => ({ id: d.id, label: d.title }))
          },
          render: renderWikiLinkSuggestion
        }
      })
    ],
    editorProps: {
      handleClickOn: (view, _pos, node, _nodePos, event) => {
        if (node.type.name !== 'wikiLink') return false
        const docId = node.attrs.docId as string | null
        const anchor = node.attrs.anchor as string | null
        const label = node.attrs.label as string | null
        // Same-note anchor `[[#Heading]]` (empty label, no docId): scroll locally.
        // A non-empty label with a null docId is a broken link — fall through.
        if (anchor && !docId && !label) {
          scrollToHeadingInView(view, anchor)
          return true
        }
        if (!docId) return false
        // Cmd/Ctrl-click opens the linked note in a new tab (matches the file tree).
        onNavigateToDocRef.current?.(docId, { newTab: event.metaKey || event.ctrlKey })
        return true
      },
      // Standard markdown anchor links `[text](#slug)` render as real <a href="#…">
      // (the Link mark). Without this the browser would hash-navigate to
      // localhost/#slug and go nowhere; instead we scroll to the matching heading.
      handleClick: (view, _pos, event) => {
        const a = (event.target as HTMLElement | null)?.closest('a[href^="#"]')
        if (!a) return false
        event.preventDefault()
        const slug = decodeURIComponent((a.getAttribute('href') ?? '#').slice(1))
        if (slug) scrollToHeadingInView(view, slug)
        return true
      }
    },
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
      {document && editable && (
        <NoteFacetBar
          document={document}
          editor={editor}
          onNavigateToDoc={onNavigateToDoc}
          onNavigateBack={onNavigateBack}
          onNavigateForward={onNavigateForward}
          canNavigateBack={canNavigateBack}
          canNavigateForward={canNavigateForward}
        />
      )}
      <div
        className={cn('flex-1 min-h-0 overflow-auto', document && editable && 'note-has-header')}
      >
        {document && editable && (
          <div className="mx-auto w-full max-w-[56rem] px-16 pt-12">
            <DocumentTitle document={document} />
          </div>
        )}
        <TableContextMenu editor={editor}>
          <EditorContent editor={editor} />
        </TableContextMenu>
        <BubbleMenuBar editor={editor} onQuoteSelection={onQuoteSelection} />
        <TableCellDropdownMenu editor={editor} />
      </div>
    </div>
  )
}
