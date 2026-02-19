import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import ListItem from '@tiptap/extension-list-item'
import { mergeAttributes } from '@tiptap/core'

export const OutlinerList = BulletList.extend({
  name: 'outlinerList',

  content: 'outlinerItem+',

  addOptions() {
    return {
      ...this.parent?.(),
      itemTypeName: 'outlinerItem',
      keepMarks: false,
      keepAttributes: false,
      HTMLAttributes: {
        class: 'outliner-list'
      }
    }
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  parseHTML() {
    return [{ tag: 'div.outliner-list' }]
  }
})

export const OutlinerOrderedList = OrderedList.extend({
  name: 'outlinerOrderedList',

  content: 'outlinerItem+',

  addOptions() {
    return {
      ...this.parent?.(),
      itemTypeName: 'outlinerItem',
      keepMarks: false,
      keepAttributes: false,
      HTMLAttributes: {
        class: 'outliner-ordered-list'
      }
    }
  },

  renderHTML({ HTMLAttributes }) {
    return ['ol', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  parseHTML() {
    return [{ tag: 'ol' }]
  }
})

export const OutlinerItem = ListItem.extend({
  name: 'outlinerItem',

  addOptions() {
    return {
      ...this.parent?.(),
      bulletListTypeName: 'outlinerList',
      orderedListTypeName: 'outlinerOrderedList',
      HTMLAttributes: {
        class: 'outliner-item'
      }
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-block-id'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.blockId) return {}
          return { 'data-block-id': attributes.blockId }
        }
      },
      blockType: {
        default: 'paragraph',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-block-type') || 'paragraph',
        renderHTML: (attributes: Record<string, unknown>) => {
          if (attributes.blockType === 'paragraph') return {}
          return { 'data-block-type': attributes.blockType }
        }
      },
      collapsed: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-collapsed') === 'true',
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.collapsed) return {}
          return { 'data-collapsed': 'true' }
        }
      },
      checked: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-checked') === 'true',
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.checked) return {}
          return { 'data-checked': 'true' }
        }
      }
    }
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-block-type': node.attrs.blockType
      }),
      0
    ]
  },

  parseHTML() {
    return [{ tag: 'div.outliner-item' }]
  }
})
