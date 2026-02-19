import { Extension } from '@tiptap/core'
import { type Editor, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import type { LucideIcon } from 'lucide-react'
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  ListTodo,
  TextQuote,
  Code,
  Table,
  ImageIcon
} from 'lucide-react'

export interface SlashCommandItem {
  title: string
  description: string
  icon: LucideIcon
  command: (props: { editor: Editor; range: Range }) => void
}

const slashCommandItems: SlashCommandItem[] = [
  {
    title: 'Text',
    description: 'Convert to paragraph',
    icon: Type,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run()
    }
  },
  {
    title: 'Heading 1',
    description: 'Large heading',
    icon: Heading1,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
    }
  },
  {
    title: 'Heading 2',
    description: 'Medium heading',
    icon: Heading2,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
    }
  },
  {
    title: 'Heading 3',
    description: 'Small heading',
    icon: Heading3,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
    }
  },
  {
    title: 'Task List',
    description: 'Checkbox list',
    icon: ListTodo,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    }
  },
  {
    title: 'Blockquote',
    description: 'Quote block',
    icon: TextQuote,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setBlockquote().run()
    }
  },
  {
    title: 'Code Block',
    description: 'Code snippet',
    icon: Code,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setCodeBlock().run()
    }
  },
  {
    title: 'Table',
    description: 'Insert a table',
    icon: Table,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run()
    }
  },
  {
    title: 'Image',
    description: 'Insert an image',
    icon: ImageIcon,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      window.api.images.pick().then(async (filePath) => {
        if (!filePath) return
        const url = await window.api.images.save(filePath)
        editor.chain().focus().setImage({ src: url }).run()
      })
    }
  }
]

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({
          editor,
          range,
          props
        }: {
          editor: Editor
          range: Range
          props: SlashCommandItem
        }) => {
          props.command({ editor, range })
        },
        items: ({ query }: { query: string }) => {
          return slashCommandItems.filter((item) =>
            item.title.toLowerCase().includes(query.toLowerCase())
          )
        }
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
