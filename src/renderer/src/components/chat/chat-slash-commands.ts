import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { type Editor, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'

export interface ChatSlashCommandItem {
  title: string
  description: string
  /** Text inserted into the input when the command is selected */
  prefix: string
  /** If true, immediately send the message instead of letting the user edit */
  autoSend?: boolean
}

export const chatSlashCommandPluginKey = new PluginKey('chatSlashCommand')

export const SlashCommandChip = Node.create({
  name: 'slashCommandChip',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      title: { default: '' },
      prefix: { default: '' }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-slash-command]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ 'data-slash-command': '', class: 'slash-command-chip' }, HTMLAttributes),
      `/${HTMLAttributes.title}`
    ]
  }
})

export const ChatSlashCommands = Extension.create({
  name: 'chatSlashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        pluginKey: chatSlashCommandPluginKey,
        startOfLine: true,
        command: ({
          editor,
          range,
          props
        }: {
          editor: Editor
          range: Range
          props: ChatSlashCommandItem
        }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: 'slashCommandChip',
                attrs: { title: props.title, prefix: props.prefix }
              },
              { type: 'text', text: ' ' }
            ])
            .run()
          if (props.autoSend) {
            // Trigger send via a custom event the ChatInput listens for
            editor.view.dom.dispatchEvent(new CustomEvent('slash-command-send'))
          }
        },
        items: () => []
      } as Partial<SuggestionOptions>
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion
      })
    ]
  }
})
