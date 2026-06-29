import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Table2 } from 'lucide-react'
import Papa from 'papaparse'
import type {
  CellClickedEventArgs,
  EditableGridCell,
  GridCell,
  GridColumn,
  GridSelection,
  HeaderClickedEventArgs,
  Item,
  Theme
} from '@glideapps/glide-data-grid'
import { registerFlusher } from '../../hooks/useAutosave'

/**
 * Full-pane EDITABLE viewer for a `.csv` "Table" artifact. Mirrors
 * `CanvasViewer`'s lifecycle: it lazy-loads the grid lib + CSS, reads the file
 * over the readArtifact IPC, and autosaves edits back through writeArtifact
 * (debounced + flushed on blur/hide/unmount, baseline-skipped, baseline advanced
 * only after a write resolves). External edits (agent rewrite, another app) live
 * -reload via `onDocumentContentChanged`, deferred while the user is interacting
 * and then replacing the grid wholesale. Our own writes never echo back
 * (suppressed by `markSelfWrite` in main).
 *
 * On-disk truth is a plain CSV. The parse-detected delimiter + linebreak are
 * captured on load and fed back into `Papa.unparse` so a ';' or tab file round
 * -trips in its own dialect. Every cell is TEXT — no type inference.
 *
 * Glide is a sizeable dep, so the component AND its CSS are dynamically imported
 * — they stay out of the main editor bundle and load only when a table opens.
 */

type GlideModule = typeof import('@glideapps/glide-data-grid')

const SAVE_DEBOUNCE_MS = 800
// While the user is mid-interaction (pointer down) or has just edited, an
// external reload is deferred so it can't yank the grid out from under them.
const INTERACTION_QUIET_MS = 1200
const DEFAULT_COL_WIDTH = 160

export interface TableViewerProps {
  /** The artifact host id (a document id). Bytes flow over the readArtifact/
   *  writeArtifact IPCs — the renderer CSP blocks gt-file:// `connect-src`. */
  gtFileId: string
  fileName?: string
  /** When set, subscribe to `documents:content-changed` and live-reload when
   *  THIS doc's bytes change on disk (agent rewrite, external edit). */
  watchDocId?: string
}

/** Read the app's current chrome theme from the `dark` class on <html>. */
function readChromeTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

// Chrome-only dark theme — keeps the grid in step with the app shell. Light uses
// Glide's defaults (undefined theme), which already read as a light surface.
const DARK_THEME: Partial<Theme> = {
  accentColor: '#4f5dff',
  accentFg: '#ffffff',
  accentLight: 'rgba(79, 93, 255, 0.2)',
  textDark: '#e5e5e5',
  textMedium: '#a1a1aa',
  textLight: '#71717a',
  textBubble: '#e5e5e5',
  bgIconHeader: '#a1a1aa',
  fgIconHeader: '#1c1c1f',
  textHeader: '#d4d4d8',
  textHeaderSelected: '#ffffff',
  bgCell: '#1c1c1f',
  bgCellMedium: '#232327',
  bgHeader: '#202023',
  bgHeaderHasFocus: '#2a2a2f',
  bgHeaderHovered: '#27272b',
  bgBubble: '#27272b',
  bgBubbleSelected: '#4f5dff',
  bgSearchResult: '#4a4a00',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  horizontalBorderColor: 'rgba(255, 255, 255, 0.06)',
  drilldownBorder: 'rgba(255, 255, 255, 0.2)',
  linkColor: '#6b9fff'
}

interface ParsedTable {
  header: string[]
  rows: string[][]
  delimiter: string
  newline: string
  /** Whether the source file ended with a terminating newline (round-tripped). */
  trailingNewline: boolean
}

/**
 * Parse CSV text: line 1 = header, but the table width is the WIDEST row (never
 * just the header) so a ragged row's extra fields are never silently dropped —
 * truncating them would make the loss permanent on the next autosave. Genuine
 * blank rows are preserved (only the single conventional terminating newline is
 * stripped, and remembered so the round-trip keeps the file newline-terminated).
 */
function parseTable(text: string): ParsedTable {
  if (text === '')
    return { header: [], rows: [], delimiter: ',', newline: '\n', trailingNewline: true }
  // skipEmptyLines: false so intentional blank rows survive the round-trip.
  const result = Papa.parse<string[]>(text, { skipEmptyLines: false })
  const records = result.data.slice()
  const delimiter = result.meta.delimiter || ','
  const newline = result.meta.linebreak || '\n'
  // A terminating newline yields a trailing [''] record — strip it and record it
  // (rather than treating it as a data row that would vanish on the next save).
  let trailingNewline = false
  const last = records[records.length - 1]
  if (records.length > 1 && last.length === 1 && last[0] === '') {
    records.pop()
    trailingNewline = true
  }
  if (!records.length) return { header: [], rows: [], delimiter, newline, trailingNewline }
  const header = records[0].map((h) => h ?? '')
  let width = header.length
  for (const r of records) if (r.length > width) width = r.length
  while (header.length < width) header.push('')
  const rows = records.slice(1).map((record) => {
    const row = new Array<string>(width)
    for (let i = 0; i < width; i++) row[i] = record[i] ?? ''
    return row
  })
  return { header, rows, delimiter, newline, trailingNewline }
}

export function TableViewer({ gtFileId, fileName, watchDocId }: TableViewerProps) {
  const [glide, setGlide] = useState<GlideModule | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [chromeTheme, setChromeTheme] = useState<'light' | 'dark'>(readChromeTheme)

  // Header + rows live in BOTH refs (so getCellContent reads the latest synchronously)
  // and state (so edits trigger a re-render / recompute of columns).
  const [header, setHeader] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [widths, setWidths] = useState<number[]>([])
  const headerRef = useRef<string[]>([])
  const rowsRef = useRef<string[][]>([])

  const glideRef = useRef<GlideModule | null>(null)
  // CSV dialect captured on load and fed back into unparse so a ';'/tab file
  // round-trips in its own dialect — never hardcode a comma.
  const delimiterRef = useRef(',')
  const newlineRef = useRef('\n')
  // Whether the loaded file ended with a newline; re-applied on serialize so an
  // edit doesn't strip the conventional terminating newline (noisy diffs).
  const trailingNewlineRef = useRef(true)
  // True while a cell's overlay editor is open. Glide gives us no per-keystroke
  // signal during overlay typing, so without this an external reload could swap
  // the model out from under an in-flight edit (landing it on the wrong cell).
  const editorOpenRef = useRef(false)

  // The serialized form of what's on disk. An edit-free flush compares equal and
  // is a no-op. Advanced ONLY after a write resolves, so a failed write leaves it
  // stale and the next flush retries rather than dropping the edit.
  const lastSavedRef = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastInteractionRef = useRef(0)
  const pointerDownRef = useRef(false)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Lightweight right-click menu (Glide has no built-in row/column ops menu).
  const [menu, setMenu] = useState<{
    type: 'header' | 'cell'
    col: number
    row: number
    x: number
    y: number
  } | null>(null)
  const [renaming, setRenaming] = useState<{
    col: number
    value: string
    x: number
    y: number
  } | null>(null)

  // --- serialize the current model in its captured dialect -------------------
  const serialize = useCallback((): string => {
    const csv = Papa.unparse(
      { fields: headerRef.current, data: rowsRef.current },
      { delimiter: delimiterRef.current, newline: newlineRef.current }
    )
    // Papa.unparse never emits a terminating newline; re-apply the source's so an
    // edit doesn't rewrite the whole file's last line / un-terminate it.
    return trailingNewlineRef.current ? csv + newlineRef.current : csv
  }, [])

  // --- lazy-load Glide (component + CSS) ------------------------------------
  useEffect(() => {
    let cancelled = false
    Promise.all([
      import('@glideapps/glide-data-grid'),
      import('@glideapps/glide-data-grid/dist/index.css')
    ])
      .then(([m]) => {
        if (cancelled) return
        glideRef.current = m
        setGlide(m)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // --- adopt a parsed table into refs + state -------------------------------
  const adopt = useCallback(
    (text: string): void => {
      const parsed = parseTable(text)
      headerRef.current = parsed.header
      rowsRef.current = parsed.rows
      delimiterRef.current = parsed.delimiter
      newlineRef.current = parsed.newline
      trailingNewlineRef.current = parsed.trailingNewline
      setHeader(parsed.header)
      setRows(parsed.rows)
      // Column widths are view-only state (never serialized). Preserve the user's
      // sizing across an external reload when the column count is unchanged; only
      // (re)initialize widths when the shape changes (incl. first load).
      setWidths((prev) =>
        prev.length === parsed.header.length
          ? prev
          : parsed.header.map((_, i) => prev[i] ?? DEFAULT_COL_WIDTH)
      )
      // Adopt the reserialized form as the saved baseline so a freshly loaded
      // table isn't immediately written back.
      lastSavedRef.current = serialize()
    },
    [serialize]
  )

  // --- load the table from disk --------------------------------------------
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    window.api
      .readArtifactText(gtFileId)
      .then((text) => {
        if (cancelled) return
        adopt(text)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [gtFileId, adopt])

  // --- follow the chrome theme (chrome only) -------------------------------
  useEffect(() => {
    const observer = new MutationObserver(() => setChromeTheme(readChromeTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // --- autosave: serialize and write back ----------------------------------
  const flush = useCallback((): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (status !== 'ready') return Promise.resolve()
    const csv = serialize()
    // Skip the write when nothing changed since the last save/load.
    if (csv === lastSavedRef.current) return Promise.resolve()
    // Advance the baseline ONLY after the write resolves: a failed write leaves
    // it stale so the next flush retries instead of dropping the edit.
    return window.api.writeArtifact(gtFileId, csv).then(
      () => {
        lastSavedRef.current = csv
      },
      (err: unknown) => {
        console.error('[table] autosave failed', err)
      }
    )
  }, [gtFileId, serialize, status])

  const scheduleSave = useCallback((): void => {
    lastInteractionRef.current = Date.now()
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
  }, [flush])

  // Commit a new model: update refs (synchronous for getCellContent), state (re
  // -render) and arm the debounced save.
  const commit = useCallback(
    (nextHeader: string[], nextRows: string[][], nextWidths?: number[]): void => {
      headerRef.current = nextHeader
      rowsRef.current = nextRows
      setHeader(nextHeader)
      setRows(nextRows)
      if (nextWidths) setWidths(nextWidths)
      scheduleSave()
    },
    [scheduleSave]
  )

  // Flush on unmount, window hide, and visibility-hidden; register into the
  // global flush registry so the quit handshake awaits this write too.
  useEffect(() => {
    const onHide = (): void => void flush()
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') void flush()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    const unregister = registerFlusher(gtFileId, flush)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      unregister()
      void flush()
    }
  }, [gtFileId, flush])

  // --- external reload: re-read and replace, deferred while interacting -----
  const applyExternal = useCallback((): void => {
    if (
      pointerDownRef.current ||
      editorOpenRef.current ||
      Date.now() - lastInteractionRef.current < INTERACTION_QUIET_MS
    ) {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(applyExternal, INTERACTION_QUIET_MS)
      return
    }
    window.api
      .readArtifactText(gtFileId)
      .then((text) => {
        // Replace the grid wholesale; adopt() resets the saved baseline so the
        // just-reloaded data isn't written straight back.
        adopt(text)
      })
      .catch((err: unknown) => {
        console.error('[table] external reload failed', err)
      })
  }, [gtFileId, adopt])

  useEffect(() => {
    if (!watchDocId) return
    return window.api.onDocumentContentChanged((data) => {
      if (data.id === watchDocId) applyExternal()
    })
  }, [watchDocId, applyExternal])

  useEffect(() => {
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
    }
  }, [])

  // --- grid data plumbing ---------------------------------------------------
  const columns = useMemo<GridColumn[]>(() => {
    return header.map((title, i) => ({
      // Empty header shows a placeholder for DISPLAY only; the real (possibly
      // empty) header text is what gets serialized on save.
      title: title === '' ? `Column ${i + 1}` : title,
      id: String(i),
      width: widths[i] ?? DEFAULT_COL_WIDTH,
      hasMenu: true
    }))
  }, [header, widths])

  const getCellContent = useCallback((cell: Item): GridCell => {
    const g = glideRef.current
    const [col, row] = cell
    const value = rowsRef.current[row]?.[col] ?? ''
    return {
      kind: (g?.GridCellKind.Text ?? 'text') as GridCell['kind'] & 'text',
      data: value,
      displayData: value,
      allowOverlay: true
    }
  }, [])

  const onCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell): void => {
      const g = glideRef.current
      if (!g || newValue.kind !== g.GridCellKind.Text) return
      const [col, row] = cell
      const nextRows = rowsRef.current.map((r) => r.slice())
      if (!nextRows[row]) return
      nextRows[row][col] = newValue.data
      editorOpenRef.current = false
      commit(headerRef.current, nextRows)
    },
    [commit]
  )

  // Track the overlay editor's open/closed state so an external reload defers
  // while the user is mid-edit (Glide emits no per-keystroke signal otherwise).
  const onCellActivated = useCallback((): void => {
    editorOpenRef.current = true
    lastInteractionRef.current = Date.now()
  }, [])

  const onFinishedEditing = useCallback((): void => {
    editorOpenRef.current = false
    lastInteractionRef.current = Date.now()
  }, [])

  // Batch edits (fill-handle drag, multi-cell clear). Returning true prevents the
  // per-cell onCellEdited fan-out.
  const onCellsEdited = useCallback(
    (newValues: readonly { location: Item; value: EditableGridCell }[]): boolean => {
      const g = glideRef.current
      if (!g) return false
      const nextRows = rowsRef.current.map((r) => r.slice())
      for (const { location, value } of newValues) {
        if (value.kind !== g.GridCellKind.Text) continue
        const [col, row] = location
        if (nextRows[row]) nextRows[row][col] = value.data
      }
      editorOpenRef.current = false
      commit(headerRef.current, nextRows)
      return true
    },
    [commit]
  )

  // Range paste — we own the model, so we apply it (and grow rows to fit) here.
  // Returning true lets Glide finish its paste UI; the in-bounds re-apply via
  // onCellsEdited is idempotent.
  const onPaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]): boolean => {
      const width = headerRef.current.length
      if (width === 0) return false
      const [startCol, startRow] = target
      const nextRows = rowsRef.current.map((r) => r.slice())
      const needed = startRow + values.length
      while (nextRows.length < needed) nextRows.push(new Array<string>(width).fill(''))
      values.forEach((rowVals, r) => {
        rowVals.forEach((val, c) => {
          const col = startCol + c
          if (col < width) nextRows[startRow + r][col] = val
        })
      })
      commit(headerRef.current, nextRows)
      return true
    },
    [commit]
  )

  // Trailing-row affordance: append an empty row of header width.
  const onRowAppended = useCallback((): void => {
    const width = headerRef.current.length
    const nextRows = [...rowsRef.current, new Array<string>(width).fill('')]
    commit(headerRef.current, nextRows)
  }, [commit])

  // Delete key: drop fully-selected rows; otherwise clear the selected cells.
  const onDelete = useCallback(
    (selection: GridSelection): GridSelection | boolean => {
      const selectedRows = selection.rows.toArray()
      if (selectedRows.length > 0) {
        const drop = new Set(selectedRows)
        const nextRows = rowsRef.current.filter((_, i) => !drop.has(i))
        commit(headerRef.current, nextRows)
        return false
      }
      return true
    },
    [commit]
  )

  const onColumnResize = useCallback(
    (_column: GridColumn, newSize: number, colIndex: number): void => {
      setWidths((prev) => {
        const next = prev.slice()
        next[colIndex] = newSize
        return next
      })
    },
    []
  )

  // --- column / row ops via the right-click menu ---------------------------
  const addColumn = useCallback((): void => {
    const nextHeader = [...headerRef.current, '']
    const nextRows = rowsRef.current.map((r) => [...r, ''])
    commit(nextHeader, nextRows, [...widths, DEFAULT_COL_WIDTH])
  }, [commit, widths])

  const deleteColumn = useCallback(
    (col: number): void => {
      const nextHeader = headerRef.current.filter((_, i) => i !== col)
      const nextRows = rowsRef.current.map((r) => r.filter((_, i) => i !== col))
      commit(
        nextHeader,
        nextRows,
        widths.filter((_, i) => i !== col)
      )
    },
    [commit, widths]
  )

  const deleteRow = useCallback(
    (row: number): void => {
      const nextRows = rowsRef.current.filter((_, i) => i !== row)
      commit(headerRef.current, nextRows)
    },
    [commit]
  )

  const renameColumn = useCallback(
    (col: number, value: string): void => {
      const nextHeader = headerRef.current.slice()
      nextHeader[col] = value
      commit(nextHeader, rowsRef.current)
    },
    [commit]
  )

  const onHeaderContextMenu = useCallback(
    (colIndex: number, event: HeaderClickedEventArgs): void => {
      event.preventDefault()
      setRenaming(null)
      setMenu({
        type: 'header',
        col: colIndex,
        row: -1,
        x: event.bounds.x + (event.localEventX ?? 0),
        y: event.bounds.y + (event.localEventY ?? 0)
      })
    },
    []
  )

  const onCellContextMenu = useCallback((cell: Item, event: CellClickedEventArgs): void => {
    event.preventDefault()
    setRenaming(null)
    const [col, row] = cell
    setMenu({
      type: 'cell',
      col,
      row,
      x: event.bounds.x + (event.localEventX ?? 0),
      y: event.bounds.y + (event.localEventY ?? 0)
    })
  }, [])

  // Close the menu on any outside interaction.
  useEffect(() => {
    if (!menu && !renaming) return
    const close = (): void => {
      setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
    }
  }, [menu, renaming])

  // --- render ---------------------------------------------------------------
  if (status === 'error') {
    return (
      <div className="flex flex-col flex-1 min-h-0 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="text-sm text-foreground">Couldn’t open this table.</p>
          {error && <p className="mt-1 text-xs text-muted-foreground break-words">{error}</p>}
        </div>
      </div>
    )
  }

  const DataEditor = glide?.DataEditor
  const ready = status === 'ready' && DataEditor

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b dark:border-white/5 border-black/5 bg-muted/50 shrink-0">
        <Table2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{fileName ?? 'Table'}</span>
        <div className="flex-1" />
        <button
          onClick={addColumn}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          title="Add column"
        >
          <Plus className="h-3 w-3" />
          Column
        </button>
      </div>

      {!ready && (
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          <span className="text-xs text-muted-foreground">Loading table…</span>
        </div>
      )}

      {ready && DataEditor && (
        <div
          className="flex-1 min-h-0 relative"
          onPointerDown={() => {
            pointerDownRef.current = true
            // A fresh pointer interaction means any prior overlay is gone; clear
            // the flag so it can never get stuck true and block reloads forever.
            editorOpenRef.current = false
            lastInteractionRef.current = Date.now()
          }}
          onPointerUp={() => {
            pointerDownRef.current = false
            lastInteractionRef.current = Date.now()
          }}
        >
          <DataEditor
            className="h-full w-full"
            theme={chromeTheme === 'dark' ? DARK_THEME : undefined}
            getCellContent={getCellContent}
            columns={columns}
            rows={rows.length}
            rowMarkers="number"
            fillHandle
            keybindings={{ copy: true, paste: true, selectAll: true }}
            getCellsForSelection
            onCellEdited={onCellEdited}
            onCellsEdited={onCellsEdited}
            onCellActivated={onCellActivated}
            onFinishedEditing={onFinishedEditing}
            onPaste={onPaste}
            onDelete={onDelete}
            onRowAppended={onRowAppended}
            onColumnResize={onColumnResize}
            onHeaderContextMenu={onHeaderContextMenu}
            onCellContextMenu={onCellContextMenu}
            trailingRowOptions={{ sticky: true, tint: true, hint: 'Add row…' }}
          />

          {menu && (
            <div
              className="fixed z-50 min-w-[140px] rounded-md border border-black/10 dark:border-white/10 bg-popover py-1 text-sm shadow-md"
              style={{ left: menu.x, top: menu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {menu.type === 'header' && (
                <>
                  <button
                    className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                    onClick={() => {
                      setRenaming({
                        col: menu.col,
                        value: headerRef.current[menu.col] ?? '',
                        x: menu.x,
                        y: menu.y
                      })
                      setMenu(null)
                    }}
                  >
                    Rename column
                  </button>
                  <button
                    className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                    onClick={() => {
                      deleteColumn(menu.col)
                      setMenu(null)
                    }}
                  >
                    Delete column
                  </button>
                </>
              )}
              {menu.type === 'cell' && (
                <>
                  <button
                    className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                    onClick={() => {
                      deleteRow(menu.row)
                      setMenu(null)
                    }}
                  >
                    Delete row
                  </button>
                  <button
                    className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                    onClick={() => {
                      deleteColumn(menu.col)
                      setMenu(null)
                    }}
                  >
                    Delete column
                  </button>
                </>
              )}
            </div>
          )}

          {renaming && (
            <input
              autoFocus
              className="fixed z-50 rounded-md border border-black/10 dark:border-white/10 bg-popover px-2 py-1 text-sm shadow-md outline-none"
              style={{ left: renaming.x, top: renaming.y }}
              value={renaming.value}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  renameColumn(renaming.col, renaming.value)
                  setRenaming(null)
                } else if (e.key === 'Escape') {
                  setRenaming(null)
                }
              }}
              onBlur={() => {
                renameColumn(renaming.col, renaming.value)
                setRenaming(null)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default TableViewer
