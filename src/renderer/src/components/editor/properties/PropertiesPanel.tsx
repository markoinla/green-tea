import { useEffect, useState } from 'react'
import {
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
import type { PropertyType } from '../../../../../main/vault/metadata'
import { cn } from '@renderer/lib/utils'
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
  valueToInputString,
  valueToBoolean,
  toStringArray,
  inputStringToValue,
  arrayToValue,
  validatePropertyName,
  PROPERTY_TYPES,
  READONLY_RESERVED_KEYS,
  type PropertyRow
} from './properties-model'
import type { PropertyData } from './usePropertyData'

const TYPE_ICON: Record<PropertyType, React.ComponentType<{ className?: string }>> = {
  text: Type,
  number: Hash,
  checkbox: ToggleLeft,
  date: Calendar,
  list: ListChecks,
  tags: Tags
}

/**
 * The Properties editor body, rendered inside the note facet bar's inline panel.
 * Holds no open/close state of its own — the bar owns that. All writes go
 * through `db:documents:updateFrontmatter` (field-merge) via {@link PropertyData}.
 */
export function PropertiesPanel({ data }: { data: PropertyData }) {
  const { rows, existingKeys, frontmatter, workspaceId, writeKey, setType, addProperty } = data

  return (
    <div className="flex flex-col gap-1.5">
      {/* title is rendered as the heading above (DocumentTitle), not as a row. */}
      {READONLY_RESERVED_KEYS.map((key) => {
        const raw = frontmatter[key]
        return (
          <ReadonlyRow
            key={key}
            label={key}
            icon={Calendar}
            value={raw !== undefined ? formatReadonlyDate(String(raw)) : '—'}
          />
        )
      })}

      {rows.map((row) => (
        <PropertyRowEditor
          key={row.key}
          row={row}
          onChangeValue={(v) => writeKey(row.key, v)}
          onRemove={() => writeKey(row.key, null)}
          onSetType={(t) => setType(row.key, t)}
          onFilter={(value) => data.filterByValue(row.key, value)}
          tagSuggest={data.tagSuggest}
        />
      ))}

      <AddPropertyControl
        existingKeys={existingKeys}
        workspaceId={workspaceId}
        onAdd={addProperty}
      />
    </div>
  )
}

/** Reformat an ISO timestamp's date part to MM/DD/YYYY (timezone-safe). */
function formatReadonlyDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  return m ? `${m[2]}/${m[3]}/${m[1]}` : raw
}

function ReadonlyRow({
  label,
  value,
  icon: Icon
}: {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex items-center gap-2 text-sm min-h-7">
      <div className="w-36 shrink-0 flex items-center gap-1.5 text-muted-foreground">
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground/70" />}
        <span className="truncate" title={label}>
          {label}
        </span>
      </div>
      <span className="flex-1 truncate text-foreground/90">{value}</span>
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
    <div className="flex items-center gap-2 text-sm group min-h-7">
      <div className="w-36 shrink-0 flex items-center gap-1.5 text-muted-foreground">
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
          className="shrink-0 text-muted-foreground/70 hover:text-foreground"
        >
          <Icon className="size-4" />
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
 * the note-list filter to that value.
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
        className={cn(
          'h-7 px-1 -mx-1 rounded border-transparent bg-transparent dark:bg-transparent shadow-none',
          'hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:border-transparent focus-visible:ring-0',
          type === 'text' && 'w-full'
        )}
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
        <Button
          variant="ghost"
          size="sm"
          className="self-start -ml-2 mt-0.5 gap-1.5 text-sm font-normal text-muted-foreground"
        >
          <Plus className="size-4" />
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
