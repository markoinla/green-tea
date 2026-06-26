import { Node, mergeAttributes } from '@tiptap/core'
import { type Editor, type Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, {
  type SuggestionMatch,
  type SuggestionOptions,
  type Trigger
} from '@tiptap/suggestion'

// A wiki-link is an inline atom rendered as `[[Label]]`. We keep our own node
// (rather than reusing @tiptap/extension-mention) because the label/docId pair
// must round-trip through our markdown serializer as literal `[[Label]]` text —
// the mention extension's HTML/data-id shape does not.
//
// `docId` is the resolved target document id (null when unresolved/broken).
// `label` is the human-readable title shown in the document and written to disk.

export interface WikiLinkSuggestionItem {
  id: string
  label: string
}

export const wikiLinkSuggestionPluginKey = new PluginKey('wikiLinkSuggestion')

// `@tiptap/suggestion` only supports a single-character trigger, but we want
// `[[`. We trigger on the first `[` and require the character immediately before
// the query to be a second `[`, with no closing `]]` inside the query. The
// returned range starts at that first `[` so `command` replaces the whole
// `[[query` span.
function findWikiLinkMatch(config: Trigger): SuggestionMatch {
  const { $position } = config
  const text = $position.nodeBefore?.isText && $position.nodeBefore.text
  if (!text) return null

  // Match `[[` followed by a query that contains neither `[` nor `]`, anchored
  // to the end of the text before the cursor.
  const regex = /\[\[([^[\]]*)$/
  const match = text.match(regex)
  if (!match) return null

  const matchIndex = match.index ?? 0
  const from = $position.pos - (text.length - matchIndex)
  const to = $position.pos

  return {
    range: { from, to },
    query: match[1],
    text: match[0]
  }
}

export const WikiLink = Node.create({
  name: 'wikiLink',

  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      suggestion: {
        char: '[',
        pluginKey: wikiLinkSuggestionPluginKey,
        findSuggestionMatch: findWikiLinkMatch,
        command: ({
          editor,
          range,
          props
        }: {
          editor: Editor
          range: Range
          props: WikiLinkSuggestionItem
        }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'wikiLink', attrs: { docId: props.id, label: props.label } },
              { type: 'text', text: ' ' }
            ])
            .run()
        }
      } as Partial<SuggestionOptions>
    }
  },

  addAttributes() {
    return {
      docId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-doc-id'),
        renderHTML: (attrs) => (attrs.docId ? { 'data-doc-id': attrs.docId } : {})
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-label'),
        renderHTML: (attrs) => (attrs.label ? { 'data-label': attrs.label } : {})
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-wiki-link]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    // WYSIWYG (Obsidian Live Preview): show only the title, not the `[[ ]]`
    // markup. A resolved link reads as a primary-colored, clickable link; an
    // unresolved (broken) link is muted with a dashed underline and is not
    // navigable. The literal `[[Label]]` still lives on disk — that's produced by
    // the markdown serializer from the node attrs, independent of this rendering.
    const resolved = !!node.attrs.docId
    const cls = resolved
      ? 'wiki-link wiki-link-resolved text-primary underline cursor-pointer'
      : 'wiki-link wiki-link-broken text-muted-foreground underline decoration-dashed cursor-default'
    return [
      'span',
      mergeAttributes({ 'data-wiki-link': '', class: cls }, HTMLAttributes),
      `${node.attrs.label ?? ''}`
    ]
  },

  // Plain-text (getText / clipboard) keeps the `[[Label]]` syntax so a copied
  // link stays a link when pasted elsewhere — only the on-screen HTML hides it.
  renderText({ node }) {
    return `[[${node.attrs.label ?? ''}]]`
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
