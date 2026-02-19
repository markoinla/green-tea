import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useEditor, ReactRenderer, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import { PluginKey } from '@tiptap/pm/state'
import { MentionList } from './MentionList'
import {
  ChatSlashCommands,
  SlashCommandChip,
  type ChatSlashCommandItem
} from './chat-slash-commands'
import { renderChatSlashSuggestion } from './ChatSlashCommandList'
import { useSkills } from '@renderer/hooks/useSkills'
import { LARGE_PASTE_THRESHOLD } from './chat-input-constants'
import { isImageMimeType, type RichTextNode, walkRichText } from './chat-input-utils'
import type { DocumentRef } from './chat-input-types'

interface UseChatInputEditorOptions {
  disabled: boolean
  isStreaming: boolean
  documents: DocumentRef[]
  showSlashCommands: boolean
  onHasContentChange: (hasContent: boolean) => void
  onLargePaste: (text: string) => void
}

interface UseChatInputEditorResult {
  editor: Editor | null
  isMentionActiveRef: React.MutableRefObject<boolean>
  isSlashActiveRef: React.MutableRefObject<boolean>
  extractMentions: () => DocumentRef[]
  getPlainText: () => string
}

export function useChatInputEditor({
  disabled,
  isStreaming,
  documents,
  showSlashCommands,
  onHasContentChange,
  onLargePaste
}: UseChatInputEditorOptions): UseChatInputEditorResult {
  const documentsRef = useRef(documents)
  documentsRef.current = documents

  const showSlashRef = useRef(showSlashCommands)
  showSlashRef.current = showSlashCommands

  const { skills } = useSkills()
  const skillsRef = useRef(skills)
  skillsRef.current = skills

  const isMentionActiveRef = useRef(false)
  const isSlashActiveRef = useRef(false)

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        code: false,
        bold: false,
        italic: false,
        strike: false
      }),
      Placeholder.configure({
        placeholder: 'Ask anything...'
      }),
      Mention.configure({
        HTMLAttributes: {
          class: 'mention'
        },
        suggestion: {
          char: '@',
          pluginKey: new PluginKey('mentionSuggestion'),
          items: ({ query }) => {
            return documentsRef.current
              .filter((doc) => doc.title.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 8)
              .map((doc) => ({ id: doc.id, label: doc.title }))
          },
          render: () => {
            let component: ReactRenderer<{
              onKeyDown: (props: { event: KeyboardEvent }) => boolean
            }> | null = null
            let popup: HTMLDivElement | null = null

            return {
              onStart: (props) => {
                isMentionActiveRef.current = true

                component = new ReactRenderer(MentionList, {
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
              onUpdate: (props) => {
                component?.updateProps(props)

                const rect = props.clientRect?.()
                if (rect && popup) {
                  popup.style.left = `${rect.left}px`
                  popup.style.top = `${rect.top - popup.offsetHeight}px`
                }
              },
              onKeyDown: (props) => {
                if (props.event.key === 'Escape') {
                  popup?.remove()
                  component?.destroy()
                  popup = null
                  component = null
                  isMentionActiveRef.current = false
                  return true
                }
                return component?.ref?.onKeyDown(props) ?? false
              },
              onExit: () => {
                popup?.remove()
                component?.destroy()
                popup = null
                component = null
                isMentionActiveRef.current = false
              }
            }
          }
        }
      }),
      SlashCommandChip,
      ChatSlashCommands.configure({
        suggestion: {
          items: ({ query }: { query: string }) => {
            if (!showSlashRef.current) return []
            return skillsRef.current
              .filter((s) => s.enabled)
              .filter(
                (s) =>
                  s.name.toLowerCase().includes(query.toLowerCase()) ||
                  s.description.toLowerCase().includes(query.toLowerCase())
              )
              .map(
                (s): ChatSlashCommandItem => ({
                  title: s.name,
                  description: s.description,
                  prefix: `Use the "${s.name}" skill to: `
                })
              )
          },
          render: () =>
            renderChatSlashSuggestion((active) => {
              isSlashActiveRef.current = active
            })
        }
      })
    ],
    []
  )

  const editor = useEditor({
    onUpdate: ({ editor: nextEditor }) => {
      onHasContentChange(!nextEditor.isEmpty)
    },
    extensions,
    editorProps: {
      attributes: {
        class: 'outline-none text-sm text-foreground min-h-[20px] max-h-[150px] overflow-y-auto'
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items
        if (items) {
          for (const item of items) {
            if (isImageMimeType(item.type)) {
              return true
            }
          }
        }
        const text = event.clipboardData?.getData('text/plain')
        if (text && text.length > LARGE_PASTE_THRESHOLD) {
          onLargePaste(text)
          return true
        }
        return false
      }
    },
    editable: !disabled
  })

  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled)
    }
  }, [editor, disabled])

  useEffect(() => {
    if (!editor) return
    const placeholder = editor.extensionManager.extensions.find((e) => e.name === 'placeholder')
    if (placeholder) {
      placeholder.options.placeholder = isStreaming ? 'Send a follow-up...' : 'Ask anything...'
      editor.view.dispatch(editor.state.tr)
    }
  }, [editor, isStreaming])

  const extractMentions = useCallback((): DocumentRef[] => {
    if (!editor) return []

    const mentions: DocumentRef[] = []
    const json = editor.getJSON()
    walkRichText(json as RichTextNode, (node) => {
      if (node.type === 'mention' && node.attrs) {
        const attrs = node.attrs as { id?: string; label?: string }
        if (attrs.id && attrs.label) {
          mentions.push({ id: attrs.id, title: attrs.label })
        }
      }
    })

    const seen = new Set<string>()
    return mentions.filter((mention) => {
      if (seen.has(mention.id)) return false
      seen.add(mention.id)
      return true
    })
  }, [editor])

  const getPlainText = useCallback((): string => {
    if (!editor) return ''

    let text = ''
    const json = editor.getJSON()
    walkRichText(json as RichTextNode, (node) => {
      if (node.type === 'mention' && node.attrs) {
        const attrs = node.attrs as { label?: string }
        text += `[@${attrs.label || ''}](mention)`
        return
      }
      if (node.type === 'slashCommandChip' && node.attrs) {
        const attrs = node.attrs as { prefix?: string }
        text += attrs.prefix || ''
        return
      }
      if (node.type === 'hardBreak') {
        text += '\n'
        return
      }
      if (typeof (node as { text?: string }).text === 'string') {
        text += (node as { text: string }).text
        return
      }
      if (node.type === 'paragraph' && text.length > 0) {
        text += '\n'
      }
    })

    return text.trim()
  }, [editor])

  return {
    editor,
    isMentionActiveRef,
    isSlashActiveRef,
    extractMentions,
    getPlainText
  }
}
