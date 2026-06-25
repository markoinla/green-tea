import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, RotateCcw, Table2 } from 'lucide-react'
import Papa from 'papaparse'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '../../lib/utils'

export interface CsvViewerProps {
  /**
   * The artifact host id: a document id (v2 tree artifact). Bytes are delivered
   * over the `documents:readArtifact` IPC, NOT `gt-file://` — the renderer CSP
   * blocks `connect-src` for gt-file, so a `fetch()` would fail.
   */
  gtFileId: string
  fileName?: string
  /**
   * When set, subscribe to `documents:content-changed` and re-load + re-parse
   * when THIS doc's bytes change on disk (agent rewrite, external edit).
   */
  watchDocId?: string
}

type Row = Record<string, string>

interface ParsedCsv {
  columns: ColumnDef<Row>[]
  rows: Row[]
}

/** Build TanStack column defs from the header row; data rows are keyed by column index. */
function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true })
  const records = result.data
  if (!records.length) return { columns: [], rows: [] }

  const header = records[0]
  const columns: ColumnDef<Row>[] = header.map((name, i) => {
    const key = String(i)
    return {
      id: key,
      accessorFn: (row) => row[key] ?? '',
      header: name === '' ? `Column ${i + 1}` : name,
      cell: (ctx) => ctx.getValue<string>()
    }
  })

  const rows: Row[] = records.slice(1).map((record) => {
    const row: Row = {}
    for (let i = 0; i < header.length; i++) row[String(i)] = record[i] ?? ''
    return row
  })

  return { columns, rows }
}

/**
 * Renders a `.csv` artifact as a read-only, sortable, virtualized table. CSV is
 * data (not agent-authored code), so unlike `HtmlViewer` there is no iframe /
 * sandbox — it parses bytes client-side with papaparse and renders real DOM.
 *
 * Live-reload mirrors `HtmlViewer`: a watched doc's content change bumps
 * `reloadKey`, which re-runs the load effect; the reload button does the same.
 */
export function CsvViewer({ gtFileId, fileName, watchDocId }: CsvViewerProps) {
  const [reloadKey, setReloadKey] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedCsv>({ columns: [], rows: [] })
  const [sorting, setSorting] = useState<SortingState>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!watchDocId) return
    return window.api.onDocumentContentChanged((data) => {
      if (data.id === watchDocId) setReloadKey((k) => k + 1)
    })
  }, [watchDocId])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    window.api
      .readArtifactText(gtFileId)
      .then((text) => {
        if (cancelled) return
        setParsed(parseCsv(text))
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
  }, [gtFileId, reloadKey])

  const table = useReactTable({
    data: parsed.rows,
    columns: parsed.columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  })

  const tableRows = table.getRowModel().rows
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 33,
    overscan: 12
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()
  const paddingTop = virtualRows.length ? virtualRows[0].start : 0
  const paddingBottom = virtualRows.length ? totalSize - virtualRows[virtualRows.length - 1].end : 0

  const isEmpty = status === 'ready' && parsed.columns.length === 0
  const headerGroups = useMemo(() => table.getHeaderGroups(), [table, sorting, parsed])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b dark:border-white/5 border-black/5 bg-muted/50 shrink-0">
        <Table2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{fileName ?? 'CSV preview'}</span>
        <div className="flex-1" />
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          title="Reload"
        >
          <RotateCcw className="h-3 w-3" />
          Reload
        </button>
      </div>

      {status === 'loading' && (
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          <span className="text-xs text-muted-foreground">Loading CSV…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          <div className="max-w-md text-center">
            <p className="text-sm text-foreground">Couldn’t read this CSV file.</p>
            {error && <p className="mt-1 text-xs text-muted-foreground break-words">{error}</p>}
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          <span className="text-xs text-muted-foreground">This CSV file is empty.</span>
        </div>
      )}

      {status === 'ready' && !isEmpty && (
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              {headerGroups.map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted()
                    return (
                      <th
                        key={header.id}
                        onClick={header.column.getToggleSortingHandler()}
                        className="select-none cursor-pointer border-b border-r dark:border-white/5 border-black/5 px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap hover:text-foreground"
                      >
                        <span className="inline-flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr>
                  <td style={{ height: paddingTop }} colSpan={parsed.columns.length} />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const row = tableRows[virtualRow.index]
                return (
                  <tr key={row.id} className="hover:bg-muted/40">
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          'border-b border-r dark:border-white/5 border-black/5 px-3 py-2 align-top whitespace-pre-wrap'
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                )
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td style={{ height: paddingBottom }} colSpan={parsed.columns.length} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default CsvViewer
