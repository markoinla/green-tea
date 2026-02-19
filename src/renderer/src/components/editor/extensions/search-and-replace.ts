import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchAndReplace: {
      setSearchTerm: (term: string) => ReturnType
      setReplaceTerm: (term: string) => ReturnType
      setCaseSensitive: (val: boolean) => ReturnType
      nextSearchResult: () => ReturnType
      prevSearchResult: () => ReturnType
      replaceCurrentResult: () => ReturnType
      replaceAllResults: () => ReturnType
      openSearch: () => ReturnType
      closeSearch: () => ReturnType
    }
  }
}

export interface SearchResult {
  from: number
  to: number
}

export interface SearchStorage {
  searchTerm: string
  replaceTerm: string
  caseSensitive: boolean
  isOpen: boolean
  results: SearchResult[]
  currentIndex: number
}

const searchPluginKey = new PluginKey('searchAndReplace')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findMatches(doc: any, searchTerm: string, caseSensitive: boolean): SearchResult[] {
  const results: SearchResult[] = []
  if (!searchTerm) return results

  const term = caseSensitive ? searchTerm : searchTerm.toLowerCase()

  doc.descendants((node: { isText: boolean; text?: string }, pos: number) => {
    if (!node.isText || !node.text) return
    const text = caseSensitive ? node.text : node.text.toLowerCase()
    let index = text.indexOf(term)
    while (index !== -1) {
      results.push({ from: pos + index, to: pos + index + searchTerm.length })
      index = text.indexOf(term, index + 1)
    }
  })

  return results
}

function createDecorations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  results: SearchResult[],
  currentIndex: number
): DecorationSet {
  const decorations: Decoration[] = []

  results.forEach((result, i) => {
    const className = i === currentIndex ? 'search-match search-match-current' : 'search-match'
    decorations.push(Decoration.inline(result.from, result.to, { class: className }))
  })

  return DecorationSet.create(doc, decorations)
}

export const SearchAndReplace = Extension.create<object, SearchStorage>({
  name: 'searchAndReplace',

  addStorage() {
    return {
      searchTerm: '',
      replaceTerm: '',
      caseSensitive: false,
      isOpen: false,
      results: [],
      currentIndex: 0
    }
  },

  addCommands() {
    const getStorage = (): SearchStorage => this.storage

    return {
      setSearchTerm:
        (term: string) =>
        ({ tr, dispatch }) => {
          const s = getStorage()
          s.searchTerm = term
          const results = findMatches(tr.doc, term, s.caseSensitive)
          s.results = results
          s.currentIndex = results.length > 0 ? 0 : -1
          if (dispatch) {
            tr.setMeta(searchPluginKey, { update: true })
            dispatch(tr)
          }
          return true
        },

      setReplaceTerm: (term: string) => () => {
        getStorage().replaceTerm = term
        return true
      },

      setCaseSensitive:
        (val: boolean) =>
        ({ tr, dispatch }) => {
          const s = getStorage()
          s.caseSensitive = val
          const results = findMatches(tr.doc, s.searchTerm, val)
          s.results = results
          s.currentIndex = results.length > 0 ? 0 : -1
          if (dispatch) {
            tr.setMeta(searchPluginKey, { update: true })
            dispatch(tr)
          }
          return true
        },

      nextSearchResult:
        () =>
        ({ editor, tr, dispatch }) => {
          const s = getStorage()
          if (s.results.length === 0) return false
          s.currentIndex = (s.currentIndex + 1) % s.results.length
          if (dispatch) {
            tr.setMeta(searchPluginKey, { update: true })
            dispatch(tr)
          }
          const result = s.results[s.currentIndex]
          if (result) {
            requestAnimationFrame(() => {
              const { view } = editor
              const domAtPos = view.domAtPos(result.from)
              const node =
                domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node.parentElement
              node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            })
          }
          return true
        },

      prevSearchResult:
        () =>
        ({ editor, tr, dispatch }) => {
          const s = getStorage()
          if (s.results.length === 0) return false
          s.currentIndex = (s.currentIndex - 1 + s.results.length) % s.results.length
          if (dispatch) {
            tr.setMeta(searchPluginKey, { update: true })
            dispatch(tr)
          }
          const result = s.results[s.currentIndex]
          if (result) {
            requestAnimationFrame(() => {
              const { view } = editor
              const domAtPos = view.domAtPos(result.from)
              const node =
                domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node.parentElement
              node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            })
          }
          return true
        },

      replaceCurrentResult:
        () =>
        ({ editor, tr, dispatch }) => {
          const s = getStorage()
          if (s.currentIndex < 0 || s.results.length === 0) return false
          const result = s.results[s.currentIndex]
          if (!result) return false

          if (dispatch) {
            tr.insertText(s.replaceTerm, result.from, result.to)
            dispatch(tr)
          }

          // Re-scan after replace
          requestAnimationFrame(() => {
            editor.commands.setSearchTerm(s.searchTerm)
          })

          return true
        },

      replaceAllResults:
        () =>
        ({ editor, tr, dispatch }) => {
          const s = getStorage()
          if (s.results.length === 0) return false

          if (dispatch) {
            // Replace in reverse order to preserve positions
            const sorted = [...s.results].sort((a, b) => b.from - a.from)
            for (const result of sorted) {
              tr.insertText(s.replaceTerm, result.from, result.to)
            }
            dispatch(tr)
          }

          // Re-scan after replace all
          requestAnimationFrame(() => {
            editor.commands.setSearchTerm(s.searchTerm)
          })

          return true
        },

      openSearch:
        () =>
        ({ editor, tr, dispatch }) => {
          const s = getStorage()
          s.isOpen = true

          // Pre-fill with selected text
          const { from, to } = editor.state.selection
          if (from !== to) {
            const selectedText = editor.state.doc.textBetween(from, to)
            if (selectedText && !selectedText.includes('\n')) {
              s.searchTerm = selectedText
              const results = findMatches(tr.doc, selectedText, s.caseSensitive)
              s.results = results
              s.currentIndex = results.length > 0 ? 0 : -1
            }
          }

          if (dispatch) {
            tr.setMeta(searchPluginKey, { update: true })
            dispatch(tr)
          }
          return true
        },

      closeSearch:
        () =>
        ({ editor, tr, dispatch }) => {
          const s = getStorage()
          s.isOpen = false
          s.searchTerm = ''
          s.replaceTerm = ''
          s.results = []
          s.currentIndex = -1
          if (dispatch) {
            tr.setMeta(searchPluginKey, { update: true })
            dispatch(tr)
          }
          editor.commands.focus()
          return true
        }
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-f': () => this.editor.commands.openSearch(),
      Escape: () => {
        if (this.storage.isOpen) {
          return this.editor.commands.closeSearch()
        }
        return false
      }
    }
  },

  addProseMirrorPlugins() {
    const extensionThis = this // eslint-disable-line @typescript-eslint/no-this-alias

    return [
      new Plugin({
        key: searchPluginKey,

        state: {
          init() {
            return DecorationSet.empty
          },

          apply(tr, oldDecorations) {
            const meta = tr.getMeta(searchPluginKey)
            const storage = extensionThis.storage

            if (meta?.update || tr.docChanged) {
              if (storage.isOpen && storage.searchTerm) {
                // Re-scan on doc changes
                if (tr.docChanged) {
                  const results = findMatches(tr.doc, storage.searchTerm, storage.caseSensitive)
                  storage.results = results
                  if (storage.currentIndex >= results.length) {
                    storage.currentIndex = results.length > 0 ? 0 : -1
                  }
                }
                return createDecorations(tr.doc, storage.results, storage.currentIndex)
              }
              return DecorationSet.empty
            }

            if (tr.docChanged) {
              return oldDecorations.map(tr.mapping, tr.doc)
            }

            return oldDecorations
          }
        },

        props: {
          decorations(state) {
            return this.getState(state) ?? DecorationSet.empty
          }
        }
      })
    ]
  }
})
