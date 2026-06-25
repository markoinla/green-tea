import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Plus,
  Trash2,
  Calendar,
  Hash,
  Type,
  ListChecks,
  Tags,
  ToggleLeft,
  Filter
} from 'lucide-react'
import type { Document } from '../../../../../main/database/types'
import type { PropertyType } from '../../../../../main/vault/metadata'
import { cn } from '@renderer/lib/utils'
import { useMetadataFilter } from '@renderer/contexts/MetadataFilterContext'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { TagChipInput } from './TagChipInput'
import {
  buildPropertyRows,
  valueToInputString,
  valueToBoolean,
  toStringArray,
  inputStringToValue,
  arrayToValue,
  validatePropertyName,
  defaultValueForType,
  PROPERTY_TYPES,
  READONLY_RESERVED_KEYS,
  type PropertyRow
} from './properties-model'

const TYPE_ICON: Record<PropertyType, React.ComponentType<{ className?: string }>> = {
  text: Type,
  number: Hash,
  checkbox: ToggleLeft,
  date: Calendar,
  list: ListChecks,
  tags: Tags
}

const COLLAPSE_SETTING_KEY = 'propertiesCollapsed'

interface PropertiesBlockProps {
  document: Document
}

/**
 * Inline, collapsible Properties editor rendered as a React SIBLING above the
 * editor content (NOT a TipTap node). All writes go through
 * `db:documents:updateFrontmatter` (field-merge). Collapse state is a GLOBAL UI
 * preference in `settings` (never written to the .md file, M7).
 */
export function PropertiesBlock({ document: doc }: PropertiesBlockProps) {
  const [collapsed, setCollapsed] = useState(true)
  const [types, setTypes] = useState<{ key: string; type: PropertyType }[]>([])
  const workspaceId = doc.workspace_id
  const frontmatter = useMemo(() => doc.frontmatter ?? {}, [doc.frontmatter])
  const { setFilter } = useMetadataFilter()

  // Load + subscribe to the global collapse preference.
  useEffect(() => {
    let active = true
    window.api.settings.get(COLLAPSE_SETTING_KEY).then((v) => {
      if (active && v !== null) setCollapsed(v !== 'false')
    })
    const unsub = window.api.onSettingsChanged(() => {
      window.api.settings.get(COLLAPSE_SETTING_KEY).then((v) => {
        if (v !== null) setCollapsed(v !== 'false')
      })
    })
    return () => {
      active = false
      unsub()
    }
  }, [])

  const refreshTypes = useCallback(() => {
    if (!workspaceId) return
    window.api.metadata.getTypes(workspaceId).then(setTypes)
  }, [workspaceId])

  useEffect(() => {
    refreshTypes()
  }, [refreshTypes, doc.frontmatter])

  const rows = useMemo(() => buildPropertyRows(frontmatter, types), [frontmatter, types])
  const existingKeys = useMemo(() => rows.map((r) => r.key), [rows])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      window.api.settings.set(COLLAPSE_SETTING_KEY, String(next))
      return next
    })
  }, [])

  // Field-merge write: a single changed key (null clears it on the main side).
  const writeKey = useCallback(
    (key: string, value: unknown) => {
      window.api.documents.updateFrontmatter(doc.id, { [key]: value })
    },
    [doc.id]
  )

  const setType = useCallback(
    (key: string, type: PropertyType) => {
      if (!workspaceId) return
      window.api.metadata.setType(workspaceId, key, type).then(refreshTypes)
    },
    [workspaceId, refreshTypes]
  )

  const tagSuggest = useCallback(
    (prefix: string) => window.api.metadata.tagSuggest(workspaceId, prefix),
    [workspaceId]
  )

  // Click a tag chip / property value -> filter the note list (Phase 4). The
  // value is passed as-typed; the main side folds it for the case-insensitive
  // equality match on `value_fold`.
  const filterByValue = useCallback(
    (key: string, value: string) => {
      if (!workspaceId || value.length === 0) return
      setFilter({ workspaceId, key, value })
    },
    [workspaceId, setFilter]
  )

  return (
    <div className="border-b border-black/5 dark:border-white/5 px-6 py-2 shrink-0">
      <button
        type="button"
        onClick={toggleCollapsed}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('size-3 transition-transform', !collapsed && 'rotate-90')} />
        Properties
        {collapsed && rows.length > 0 && (
          <span className="text-muted-foreground/60">({rows.length})</span>
        )}
      </button>

      {!collapsed && (
        <div className="mt-2 flex flex-col gap-1.5">
          {/* title is sourced from Document.title, not frontmatter.title (L3). */}
          <ReadonlyRow label="title" value={doc.title} />
          {READONLY_RESERVED_KEYS.map((key) => {
            const raw = frontmatter[key]
            return (
              <ReadonlyRow key={key} label={key} value={raw !== undefined ? String(raw) : '—'} />
            )
          })}

          {rows.map((row) => (
            <PropertyRowEditor
              key={row.key}
              row={row}
              onChangeValue={(v) => writeKey(row.key, v)}
              onRemove={() => writeKey(row.key, null)}
              onSetType={(t) => setType(row.key, t)}
              onFilter={(value) => filterByValue(row.key, value)}
              tagSuggest={tagSuggest}
            />
          ))}

          <AddPropertyControl
            existingKeys={existingKeys}
            workspaceId={workspaceId}
            onAdd={(key, type) => {
              if (type !== 'text') setType(key, type)
              writeKey(key, defaultValueForType(type))
            }}
          />
        </div>
      )}
    </div>
  )
}

function ReadonlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground truncate" title={label}>
        {label}
      </span>
      <span className="flex-1 text-muted-foreground/80 truncate">{value}</span>
    </div>
  )
}

function PropertyRowEditor({
  row,
  onChangeValue,
  onRemove,
  onSetType,
  onFilter,
  tagSuggest
}: {
  row: PropertyRow
  onChangeValue: (value: unknown) => void
  onRemove: () => void
  onSetType: (type: PropertyType) => void
  onFilter: (value: string) => void
  tagSuggest: (prefix: string) => Promise<string[]>
}) {
  return (
    <div className="flex items-center gap-2 text-sm group">
      <div className="w-28 shrink-0 flex items-center gap-1">
        <TypeControl type={row.type} onSelect={onSetType} />
        <span className="truncate" title={row.key}>
          {row.key}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <PropertyWidget
          row={row}
          onChangeValue={onChangeValue}
          onFilter={onFilter}
          tagSuggest={tagSuggest}
        />
      </div>
      <button
        type="button"
        aria-label={`Remove ${row.key}`}
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0"
        onClick={onRemove}
      >
        <Trash2 className="size-3.5 text-muted-foreground" />
      </button>
    </div>
  )
}

function TypeControl({
  type,
  onSelect
}: {
  type: PropertyType
  onSelect: (type: PropertyType) => void
}) {
  const Icon = TYPE_ICON[type]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Property type: ${type}`}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Icon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32">
        {PROPERTY_TYPES.map((t) => {
          const TIcon = TYPE_ICON[t]
          return (
            <DropdownMenuItem key={t} onSelect={() => onSelect(t)}>
              <TIcon className="size-3.5" />
              <span className={cn(t === type && 'font-medium')}>{t}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PropertyWidget({
  row,
  onChangeValue,
  onFilter,
  tagSuggest
}: {
  row: PropertyRow
  onChangeValue: (value: unknown) => void
  onFilter: (value: string) => void
  tagSuggest: (prefix: string) => Promise<string[]>
}) {
  switch (row.type) {
    case 'checkbox':
      return (
        <Switch checked={valueToBoolean(row.value)} onCheckedChange={(v) => onChangeValue(v)} />
      )
    case 'tags':
      return (
        <TagChipInput
          values={toStringArray(row.value)}
          onChange={(next) => onChangeValue(arrayToValue(next))}
          onChipClick={onFilter}
          suggest={tagSuggest}
          placeholder="Add tag…"
          stripHash
        />
      )
    case 'list':
      return (
        <TagChipInput
          values={toStringArray(row.value)}
          onChange={(next) => onChangeValue(arrayToValue(next))}
          onChipClick={onFilter}
          placeholder="Add item…"
          stripHash={false}
        />
      )
    case 'date':
      return (
        <ScalarWidget type="date" row={row} onChangeValue={onChangeValue} onFilter={onFilter} />
      )
    case 'number':
      return (
        <ScalarWidget type="number" row={row} onChangeValue={onChangeValue} onFilter={onFilter} />
      )
    case 'text':
    default:
      return (
        <ScalarWidget type="text" row={row} onChangeValue={onChangeValue} onFilter={onFilter} />
      )
  }
}

/**
 * A scalar property input (text/number/date) with a click-to-filter affordance:
 * a small Filter button appears on hover when the field holds a value, setting
 * the note-list filter to that value (Phase 4).
 */
function ScalarWidget({
  type,
  row,
  onChangeValue,
  onFilter
}: {
  type: 'text' | 'number' | 'date'
  row: PropertyRow
  onChangeValue: (value: unknown) => void
  onFilter: (value: string) => void
}) {
  const current = valueToInputString(row.value, type)
  return (
    <div className="flex items-center gap-1">
      <Input
        type={type}
        className="h-7"
        defaultValue={current}
        onBlur={(e) => onChangeValue(inputStringToValue(e.target.value, type))}
      />
      {current.length > 0 && (
        <button
          type="button"
          aria-label={`Filter by ${current}`}
          title={`Filter notes by ${current}`}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0"
          onClick={() => onFilter(current)}
        >
          <Filter className="size-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}

function AddPropertyControl({
  existingKeys,
  workspaceId,
  onAdd
}: {
  existingKeys: string[]
  workspaceId: string
  onAdd: (key: string, type: PropertyType) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<PropertyType>('text')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !workspaceId) return
    let cancelled = false
    const handle = setTimeout(async () => {
      const raw = await window.api.metadata.nameSuggest(workspaceId, name.trim())
      if (cancelled) return
      const taken = new Set(existingKeys)
      setSuggestions(raw.filter((s) => !taken.has(s)).slice(0, 8))
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [open, name, workspaceId, existingKeys])

  function submit(rawName: string): void {
    const result = validatePropertyName(rawName, existingKeys)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onAdd(result.key, type)
    setName('')
    setType('text')
    setError(null)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="self-start text-muted-foreground">
          <Plus className="size-3" />
          Add property
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={name}
            placeholder="Property name"
            className="h-7"
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit(name)
              }
            }}
          />
          <TypeControl type={type} onSelect={setType} />
        </div>
        {error && <span className="text-xs text-destructive">{error}</span>}
        {suggestions.length > 0 && (
          <div className="flex flex-col">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
                onClick={() => submit(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <Button size="xs" className="self-end" onClick={() => submit(name)}>
          Add
        </Button>
      </PopoverContent>
    </Popover>
  )
}
