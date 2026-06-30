import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, Table2 } from 'lucide-react'
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
// View-state (widths/sort) is cheaper than the CSV write and changes in bursts
// (resize drag), so it gets its own short debounce.
const VIEWSTATE_DEBOUNCE_MS = 500
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

// Light theme overrides only what Glide's defaults don't cover for us — namely a
// link color for `uri` columns (Glide's default light theme has none, so a uri
// cell would render indistinguishable from text).
const LIGHT_THEME: Partial<Theme> = {
  linkColor: '#2563eb'
}

interface ParsedTable {
  header: string[]
  rows: string[][]
  delimiter: string
  newline: string
  /** Whether the source file ended with a terminating newline (round-tripped). */
  trailingNewline: boolean
}

// --- column types (schema sidecar) -----------------------------------------
// Types are a DISPLAY + sort lens only; the .csv on disk stays plain text. The
// schema lives in a sibling `<name>.csv.meta.json`, read/written via the
// readTableMeta/writeTableMeta IPCs. `text` is the default and is never written.
type ColumnType = 'text' | 'number' | 'boolean' | 'uri'
const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'boolean', 'uri']
const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Boolean',
  uri: 'URL'
}

interface TableMeta {
  version: number
  columns: { name: string; type: ColumnType }[]
}

function isColumnType(v: unknown): v is ColumnType {
  return typeof v === 'string' && (COLUMN_TYPES as string[]).includes(v)
}

/** Parse a sidecar JSON string (null/garbage → null, safe-degrade to all-text). */
function parseMeta(json: string | null): TableMeta | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const cols = (parsed as { columns?: unknown }).columns
    if (!Array.isArray(cols)) return null
    const columns = cols
      .filter((c): c is { name: string; type: ColumnType } => {
        if (!c || typeof c !== 'object') return false
        const name = (c as { name?: unknown }).name
        const type = (c as { type?: unknown }).type
        return typeof name === 'string' && isColumnType(type)
      })
      .map((c) => ({ name: c.name, type: c.type }))
    return { version: 1, columns }
  } catch {
    return null
  }
}

/**
 * Resolve per-column types against the live header by NAME-ANCHORING: match each
 * sidecar entry to the CSV header by name. Anything unmatched — including a header
 * that is blank, duplicated, or renamed/reordered by an agent — degrades to
 * `text`. This is the safe failure mode: lose a type rather than mis-apply it to
 * the wrong column.
 *
 * Resolution is name-ONLY (no positional fallback): the sidecar omits text
 * columns (see buildMeta), so `meta.columns` is sparse and NOT positionally
 * aligned with the header — indexing it by header position would mistype columns.
 * Name is also the only anchor an agent-authored `{name,type}` sidecar carries.
 * Always returns an array aligned 1:1 with `header`.
 */
function resolveColumnTypes(header: string[], meta: TableMeta | null): ColumnType[] {
  if (!meta || meta.columns.length === 0) return header.map(() => 'text')
  const byName = new Map<string, ColumnType>()
  const duplicate = new Set<string>()
  for (const c of meta.columns) {
    if (!c.name) continue
    if (byName.has(c.name)) duplicate.add(c.name)
    else byName.set(c.name, c.type)
  }
  return header.map((h) =>
    h && byName.has(h) && !duplicate.has(h) ? (byName.get(h) as ColumnType) : 'text'
  )
}

/** Serialize the current header + types to a sidecar (text columns omitted). */
function buildMeta(header: string[], types: ColumnType[]): TableMeta {
  const columns = header
    .map((name, i) => ({ name, type: types[i] ?? ('text' as ColumnType) }))
    .filter((c) => c.type !== 'text')
  return { version: 1, columns }
}

// --- view-state (DB, not on disk) ------------------------------------------
// Local UI state: column widths + sort. Both keyed by column NAME (like the schema
// sidecar) so they track a column across reorders; unmatched names fall back.
// Stored in SQLite via read/writeViewState.
type SortDir = 'asc' | 'desc'
interface SortState {
  column: string
  dir: SortDir
}
interface ViewState {
  version: number
  widths?: Record<string, number>
  sort?: SortState | null
}

function parseViewState(json: string | null): ViewState | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const widthsRaw = (parsed as { widths?: unknown }).widths
    const widths: Record<string, number> = {}
    if (widthsRaw && typeof widthsRaw === 'object') {
      for (const [k, v] of Object.entries(widthsRaw as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) widths[k] = v
      }
    }
    const sortRaw = (parsed as { sort?: unknown }).sort
    let sort: SortState | null = null
    if (sortRaw && typeof sortRaw === 'object') {
      const column = (sortRaw as { column?: unknown }).column
      const dir = (sortRaw as { dir?: unknown }).dir
      if (typeof column === 'string' && (dir === 'asc' || dir === 'desc')) sort = { column, dir }
    }
    return { version: 1, widths, sort }
  } catch {
    return null
  }
}

/** Map saved name-keyed widths onto the live header (unmatched → default). */
function widthsFromViewState(header: string[], vs: ViewState | null): number[] | undefined {
  if (!vs?.widths) return undefined
  return header.map((h) => {
    const w = h ? vs.widths?.[h] : undefined
    return typeof w === 'number' ? w : DEFAULT_COL_WIDTH
  })
}

// A type-aware comparator over the RAW cell strings of one column. Numbers compare
// numerically with non-numeric/blank values sorted last (in ascending order);
// booleans by truthiness with blanks last; text/uri lexicographically. The result
// is multiplied by the direction in computeViewToData; ties preserve input order.
function compareCells(a: string, b: string, type: ColumnType): number {
  if (type === 'number') {
    const na = parseFloat(a)
    const nb = parseFloat(b)
    const aNan = Number.isNaN(na)
    const bNan = Number.isNaN(nb)
    if (aNan && bNan) return 0
    if (aNan) return 1 // non-numeric sorts after numeric (ascending)
    if (bNan) return -1
    // Compare via </> rather than (na - nb): subtraction yields NaN for two equal
    // infinities (Infinity - Infinity), which would break the total order.
    return na === nb ? 0 : na < nb ? -1 : 1
  }
  if (type === 'boolean') {
    const rank = (v: string): number => {
      const p = parseBool(v)
      return p === undefined ? 2 : p ? 1 : 0 // false < true < blank
    }
    return rank(a) - rank(b)
  }
  return a.localeCompare(b)
}

/**
 * Build the display→data row index from the current sort. Returns identity when no
 * sort (or the sort column is gone). STABLE: ties keep their original data order,
 * unaffected by direction.
 */
function computeViewToData(
  rows: string[][],
  header: string[],
  colTypes: ColumnType[],
  sort: SortState | null
): number[] {
  const identity = rows.map((_, i) => i)
  if (!sort) return identity
  const col = header.indexOf(sort.column)
  if (col < 0) return identity
  const type = colTypes[col] ?? 'text'
  const dir = sort.dir === 'asc' ? 1 : -1
  return identity
    .map((i) => ({ i, v: rows[i]?.[col] ?? '' }))
    .sort((a, b) => {
      const c = compareCells(a.v, b.v, type) * dir
      return c !== 0 ? c : a.i - b.i
    })
    .map((x) => x.i)
}

// Tokens read as `true` for a boolean column (case-insensitive). Anything else
// non-empty reads as `false`; empty stays empty (renders no checkbox).
const BOOL_TRUE = new Set(['true', 't', 'yes', 'y', '1', 'x', '✓', 'checked'])
function parseBool(value: string): boolean | undefined {
  const v = value.trim().toLowerCase()
  if (v === '') return undefined
  return BOOL_TRUE.has(v)
}

/**
 * Convert an edited Glide cell back to the string stored in the CSV. Covers the
 * kinds our typed columns can emit (Text, Uri, Boolean — and Number defensively).
 * A boolean toggle writes a canonical token; everything else is stored verbatim.
 * Returns null for a kind we don't handle (the edit is then ignored).
 */
function editableToText(g: GlideModule, value: EditableGridCell): string | null {
  if (value.kind === g.GridCellKind.Text || value.kind === g.GridCellKind.Uri) return value.data
  if (value.kind === g.GridCellKind.Number)
    return value.data === undefined ? '' : String(value.data)
  if (value.kind === g.GridCellKind.Boolean)
    return value.data === true ? 'true' : value.data === false ? 'false' : ''
  return null
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
  const [colTypes, setColTypes] = useState<ColumnType[]>([])
  const headerRef = useRef<string[]>([])
  const rowsRef = useRef<string[][]>([])
  // Types live in a ref too so getCellContent reads the latest synchronously.
  const colTypesRef = useRef<ColumnType[]>([])
  // Widths mirrored into a ref so view-state can be serialized synchronously from
  // anywhere (resize/structural ops) without threading state through.
  const widthsRef = useRef<number[]>([])
  // Sort is a VIEW-ONLY overlay: the stored CSV order never changes. `sort` (state)
  // drives header indicators + repaint; sortRef mirrors it for synchronous reads.
  const [sort, setSort] = useState<SortState | null>(null)
  const sortRef = useRef<SortState | null>(null)
  // display-row → data-row map. Identity when unsorted. getCellContent and every
  // row-index consumer route through this; it's rebuilt on sort/structural change
  // (NOT on a value edit, so rows don't jump while you type).
  const viewToDataRef = useRef<number[]>([])
  // Whether this table has ever had a sidecar (loaded or written). Gates whether
  // an all-text schema is persisted — we never create a sidecar for a plain table.
  const hadMetaRef = useRef(false)

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
  // Debounced view-state (widths/sort) persistence + last-written baseline to skip
  // redundant writes.
  const viewStateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewStateSavedRef = useRef<string | null>(null)

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

  // --- view-state (widths/sort) persistence ---------------------------------
  // Serialize widths keyed by column name (so they track a renamed/reordered
  // column), skipping empty-named columns.
  const serializeViewState = useCallback((): string => {
    const header = headerRef.current
    const w = widthsRef.current
    const widths: Record<string, number> = {}
    header.forEach((h, i) => {
      if (h) widths[h] = w[i] ?? DEFAULT_COL_WIDTH
    })
    const vs: ViewState = { version: 1, widths, sort: sortRef.current }
    return JSON.stringify(vs)
  }, [])

  // Rebuild the display→data index from the current sort. Call on sort change and
  // structural changes (row/column add/delete, reload) — NOT on value edits.
  const rebuildView = useCallback((rows: string[][]): void => {
    viewToDataRef.current = computeViewToData(
      rows,
      headerRef.current,
      colTypesRef.current,
      sortRef.current
    )
  }, [])

  // Translate a Glide display row to the underlying data row. Falls back to identity
  // for the trailing append affordance / an empty index.
  const toDataRow = useCallback((displayRow: number): number => {
    const mapped = viewToDataRef.current[displayRow]
    return mapped === undefined ? displayRow : mapped
  }, [])

  const flushViewState = useCallback((): Promise<void> => {
    if (viewStateTimer.current) {
      clearTimeout(viewStateTimer.current)
      viewStateTimer.current = null
    }
    const json = serializeViewState()
    if (json === viewStateSavedRef.current) return Promise.resolve()
    // Return the write promise so the registered flusher (and thus the quit
    // handshake's flushAll) awaits it — matching the CSV write's durability.
    return window.api.writeViewState(gtFileId, json).then(
      () => {
        viewStateSavedRef.current = json
      },
      (err: unknown) => console.error('[table] view-state save failed', err)
    )
  }, [gtFileId, serializeViewState])

  const scheduleViewStateSave = useCallback((): void => {
    if (viewStateTimer.current) clearTimeout(viewStateTimer.current)
    viewStateTimer.current = setTimeout(() => flushViewState(), VIEWSTATE_DEBOUNCE_MS)
  }, [flushViewState])

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
    (
      text: string,
      metaJson: string | null,
      persistedWidths?: number[],
      // undefined = keep current sort (external reload); null/SortState = apply (load)
      persistedSort?: SortState | null
    ): void => {
      const parsed = parseTable(text)
      headerRef.current = parsed.header
      rowsRef.current = parsed.rows
      delimiterRef.current = parsed.delimiter
      newlineRef.current = parsed.newline
      trailingNewlineRef.current = parsed.trailingNewline
      setHeader(parsed.header)
      setRows(parsed.rows)
      // Resolve column types name-anchored against the freshly parsed header, so
      // an agent rewrite that changed columns re-aligns (or safe-degrades to text).
      const meta = parseMeta(metaJson)
      if (meta) hadMetaRef.current = true
      const types = resolveColumnTypes(parsed.header, meta)
      colTypesRef.current = types
      setColTypes(types)
      // Column widths: on initial load, seed from the persisted view-state (passed
      // in, already mapped to the live header) — computed here rather than via a
      // separate setWidths so it can't be clobbered by a default-init race. On an
      // external reload (no persistedWidths), preserve the user's current sizing
      // when the column count is unchanged, else (re)initialize to defaults.
      const prevW = widthsRef.current
      const nextWidths =
        persistedWidths && persistedWidths.length === parsed.header.length
          ? persistedWidths
          : prevW.length === parsed.header.length
            ? prevW
            : parsed.header.map((_, i) => prevW[i] ?? DEFAULT_COL_WIDTH)
      widthsRef.current = nextWidths
      setWidths(nextWidths)
      // Sort: apply the persisted sort on initial load; on an external reload
      // (persistedSort === undefined) keep the user's current sort. Then rebuild the
      // display→data index against the freshly parsed rows either way.
      if (persistedSort !== undefined) {
        sortRef.current = persistedSort
        setSort(persistedSort)
      }
      rebuildView(parsed.rows)
      // Baseline the saved view-state to what we just loaded so a load never
      // triggers a redundant write-back.
      viewStateSavedRef.current = serializeViewState()
      // Adopt the reserialized form as the saved baseline so a freshly loaded
      // table isn't immediately written back.
      lastSavedRef.current = serialize()
    },
    [serialize, serializeViewState, rebuildView]
  )

  // --- load the table from disk --------------------------------------------
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    // Read the CSV, its schema sidecar, and the DB view-state together so types +
    // widths are resolved against the same header the data is parsed from. Both
    // sidecar reads return null when absent (plain table / never sized) — not errors.
    Promise.all([
      window.api.readArtifactText(gtFileId),
      window.api.readTableMeta(gtFileId),
      window.api.readViewState(gtFileId)
    ])
      .then(([text, metaJson, viewStateJson]) => {
        if (cancelled) return
        const parsed = parseTable(text)
        const vs = parseViewState(viewStateJson)
        const widths = widthsFromViewState(parsed.header, vs)
        adopt(text, metaJson, widths, vs?.sort ?? null)
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
      // Rebuild the sort view when the row COUNT changes (add/delete) so the index
      // stays valid; a pure value edit keeps the existing order (rows don't jump
      // mid-edit). Done before setRows so getCellContent reads a consistent map.
      const countChanged = nextRows.length !== rowsRef.current.length
      headerRef.current = nextHeader
      rowsRef.current = nextRows
      if (countChanged) rebuildView(nextRows)
      setHeader(nextHeader)
      setRows(nextRows)
      if (nextWidths) {
        widthsRef.current = nextWidths
        setWidths(nextWidths)
      }
      scheduleSave()
    },
    [scheduleSave, rebuildView]
  )

  // Persist the schema sidecar. Called only on type/column changes (NOT cell
  // edits), so it never churns. Skipped entirely for a plain table that has never
  // had a sidecar (don't litter the vault with empty-schema files).
  const persistMeta = useCallback((): void => {
    const meta = buildMeta(headerRef.current, colTypesRef.current)
    if (meta.columns.length === 0 && !hadMetaRef.current) return
    hadMetaRef.current = true
    const json = JSON.stringify(meta, null, 2)
    window.api.writeTableMeta(gtFileId, json).catch((err: unknown) => {
      console.error('[table] schema write failed', err)
    })
  }, [gtFileId])

  // Set a column's type via the header menu: update the aligned types array (ref +
  // state for repaint) and persist the sidecar. The .csv bytes are untouched.
  const setColumnType = useCallback(
    (col: number, type: ColumnType): void => {
      const next = colTypesRef.current.slice()
      while (next.length < headerRef.current.length) next.push('text')
      next[col] = type
      colTypesRef.current = next
      // The sort comparator is type-dependent, so retyping the sorted column must
      // re-sort (e.g. text "9","10" → number reorders to "9","10"). Rebuild before
      // the re-render so the grid paints the corrected order.
      rebuildView(rowsRef.current)
      setColTypes(next)
      persistMeta()
    },
    [persistMeta, rebuildView]
  )

  // Flush on unmount, window hide, and visibility-hidden; register into the
  // global flush registry so the quit handshake awaits this write too.
  useEffect(() => {
    const onHide = (): void => {
      void flush()
      void flushViewState()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        void flush()
        void flushViewState()
      }
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    // Register BOTH writes (distinct ids) so the quit handshake's flushAll awaits
    // the view-state write too, not just the CSV write.
    const unregister = registerFlusher(gtFileId, flush)
    const unregisterViewState = registerFlusher(`${gtFileId}:viewstate`, flushViewState)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      unregister()
      unregisterViewState()
      void flush()
      void flushViewState()
    }
  }, [gtFileId, flush, flushViewState])

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
    // Re-read CSV AND sidecar: an agent rewrite may have changed both, and types
    // must re-anchor against the new header. (Without the sidecar re-read here,
    // the agent's write-sidecar-first ordering would never reflect in the grid.)
    Promise.all([window.api.readArtifactText(gtFileId), window.api.readTableMeta(gtFileId)])
      .then(([text, metaJson]) => {
        // Replace the grid wholesale; adopt() resets the saved baseline so the
        // just-reloaded data isn't written straight back.
        adopt(text, metaJson)
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
    return header.map((title, i) => {
      const base = title === '' ? `Column ${i + 1}` : title
      // Append a sort arrow to the active sort column's header for feedback.
      const arrow =
        sort && title !== '' && sort.column === title ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''
      return {
        // Empty header shows a placeholder for DISPLAY only; the real (possibly
        // empty) header text is what gets serialized on save.
        title: base + arrow,
        id: String(i),
        width: widths[i] ?? DEFAULT_COL_WIDTH,
        hasMenu: true
      }
    })
    // colTypes is an intentional dep: a type change isn't read in this body, but it
    // must yield a fresh `columns` array so Glide (which memoizes on prop identity)
    // repaints cells with their new kind. (sort is read, for the arrow.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header, widths, colTypes, sort])

  const getCellContent = useCallback((cell: Item): GridCell => {
    const g = glideRef.current
    const [col, row] = cell
    const dataRow = viewToDataRef.current[row] ?? row
    const value = rowsRef.current[dataRow]?.[col] ?? ''
    const type = colTypesRef.current[col] ?? 'text'
    if (g && type === 'boolean') {
      // allowOverlay MUST be the literal false for a BooleanCell; it toggles on
      // click, not via an overlay editor.
      return {
        kind: g.GridCellKind.Boolean,
        data: parseBool(value),
        allowOverlay: false
      } as GridCell
    }
    if (g && type === 'uri') {
      return {
        kind: g.GridCellKind.Uri,
        data: value,
        displayData: value,
        // Uri renders as plain text without hoverEffect; onClickUri opens external
        // (the click args carry no url, so capture this cell's value).
        hoverEffect: true,
        onClickUri: () => {
          if (value) void window.api.shell.openExternal(value)
        },
        allowOverlay: true
      } as GridCell
    }
    // text + number both ride a Text cell — number is stored verbatim and only
    // right-aligned (no native NumberCell, which would coerce/reformat the value).
    return {
      kind: (g?.GridCellKind.Text ?? 'text') as GridCell['kind'] & 'text',
      data: value,
      displayData: value,
      allowOverlay: true,
      contentAlign: type === 'number' ? 'right' : undefined
    }
  }, [])

  const onCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell): void => {
      const g = glideRef.current
      if (!g) return
      const text = editableToText(g, newValue)
      if (text === null) return
      const [col, row] = cell
      const dataRow = toDataRow(row)
      const nextRows = rowsRef.current.map((r) => r.slice())
      if (!nextRows[dataRow]) return
      nextRows[dataRow][col] = text
      editorOpenRef.current = false
      commit(headerRef.current, nextRows)
    },
    [commit, toDataRow]
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
        const text = editableToText(g, value)
        if (text === null) continue
        const [col, row] = location
        const dataRow = toDataRow(row)
        if (nextRows[dataRow]) nextRows[dataRow][col] = text
      }
      editorOpenRef.current = false
      commit(headerRef.current, nextRows)
      return true
    },
    [commit, toDataRow]
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
      values.forEach((rowVals, r) => {
        // Map each pasted display row to its data row; rows pasted past the last
        // visible row append to the data end (and re-sort via commit's rebuild).
        const displayRow = startRow + r
        let dataRow = viewToDataRef.current[displayRow]
        if (dataRow === undefined) {
          dataRow = nextRows.length
          nextRows.push(new Array<string>(width).fill(''))
        }
        rowVals.forEach((val, c) => {
          const col = startCol + c
          if (col < width) nextRows[dataRow][col] = val
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
        // selection rows are DISPLAY indices — map to data indices before dropping.
        const drop = new Set(selectedRows.map((r) => toDataRow(r)))
        const nextRows = rowsRef.current.filter((_, i) => !drop.has(i))
        commit(headerRef.current, nextRows)
        return false
      }
      return true
    },
    [commit, toDataRow]
  )

  const onColumnResize = useCallback(
    (_column: GridColumn, newSize: number, colIndex: number): void => {
      const next = widthsRef.current.slice()
      next[colIndex] = newSize
      widthsRef.current = next
      setWidths(next)
      scheduleViewStateSave()
    },
    [scheduleViewStateSave]
  )

  // Left-click a header to cycle its sort: none → asc → desc → none. View-only —
  // the stored CSV order is untouched; only the display→data index changes.
  const onHeaderClicked = useCallback(
    (colIndex: number): void => {
      const name = headerRef.current[colIndex]
      if (!name) return // unnamed column has no stable sort anchor
      const cur = sortRef.current
      const next: SortState | null =
        !cur || cur.column !== name
          ? { column: name, dir: 'asc' }
          : cur.dir === 'asc'
            ? { column: name, dir: 'desc' }
            : null
      sortRef.current = next
      setSort(next)
      rebuildView(rowsRef.current)
      scheduleViewStateSave()
    },
    [rebuildView, scheduleViewStateSave]
  )

  // --- column / row ops via the right-click menu ---------------------------
  // colTypes is positionally aligned to the header, so column add/delete must keep
  // it in step (and re-persist the sidecar so its name-anchors track the header).
  const addColumn = useCallback((): void => {
    const nextHeader = [...headerRef.current, '']
    const nextRows = rowsRef.current.map((r) => [...r, ''])
    const nextTypes = [...colTypesRef.current, 'text' as ColumnType]
    colTypesRef.current = nextTypes
    setColTypes(nextTypes)
    commit(nextHeader, nextRows, [...widthsRef.current, DEFAULT_COL_WIDTH])
  }, [commit])

  const deleteColumn = useCallback(
    (col: number): void => {
      const removedName = headerRef.current[col]
      const nextHeader = headerRef.current.filter((_, i) => i !== col)
      const nextRows = rowsRef.current.map((r) => r.filter((_, i) => i !== col))
      const nextTypes = colTypesRef.current.filter((_, i) => i !== col)
      colTypesRef.current = nextTypes
      setColTypes(nextTypes)
      // If the sorted column was the one removed, drop the sort (its column is gone).
      if (sortRef.current && sortRef.current.column === removedName) {
        sortRef.current = null
        setSort(null)
      }
      commit(
        nextHeader,
        nextRows,
        widthsRef.current.filter((_, i) => i !== col)
      )
      // Column delete doesn't change row count (commit won't rebuild), so rebuild
      // the view here against the new header/sort.
      rebuildView(rowsRef.current)
      persistMeta()
      // The deleted column's width entry disappears from the name-keyed view-state.
      scheduleViewStateSave()
    },
    [commit, persistMeta, scheduleViewStateSave, rebuildView]
  )

  const deleteRow = useCallback(
    (row: number): void => {
      // `row` is a display index (from the right-click menu) — map to data.
      const dataRow = toDataRow(row)
      const nextRows = rowsRef.current.filter((_, i) => i !== dataRow)
      commit(headerRef.current, nextRows)
    },
    [commit, toDataRow]
  )

  const renameColumn = useCallback(
    (col: number, value: string): void => {
      const oldName = headerRef.current[col]
      const nextHeader = headerRef.current.slice()
      nextHeader[col] = value
      // Sort anchors by name — follow a renamed sorted column to its new name so the
      // sort survives (and the view doesn't silently fall back to identity).
      if (sortRef.current && sortRef.current.column === oldName) {
        const next = { column: value, dir: sortRef.current.dir }
        sortRef.current = next
        setSort(next)
      }
      commit(nextHeader, rowsRef.current)
      rebuildView(rowsRef.current)
      // The sidecar anchors types by column name — re-persist so a renamed typed
      // column keeps its type across the next reload. View-state is name-keyed too,
      // so re-persist its widths under the new name.
      persistMeta()
      scheduleViewStateSave()
    },
    [commit, persistMeta, scheduleViewStateSave, rebuildView]
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
            theme={chromeTheme === 'dark' ? DARK_THEME : LIGHT_THEME}
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
            onHeaderClicked={onHeaderClicked}
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
                  <div className="my-1 border-t border-black/10 dark:border-white/10" />
                  <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Column type
                  </div>
                  {COLUMN_TYPES.map((t) => {
                    const active = (colTypes[menu.col] ?? 'text') === t
                    return (
                      <button
                        key={t}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-muted"
                        onClick={() => {
                          setColumnType(menu.col, t)
                          setMenu(null)
                        }}
                      >
                        <span>{COLUMN_TYPE_LABELS[t]}</span>
                        {active && <Check className="h-3.5 w-3.5 text-foreground" />}
                      </button>
                    )
                  })}
                  <div className="my-1 border-t border-black/10 dark:border-white/10" />
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
