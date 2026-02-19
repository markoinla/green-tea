import { useState, useEffect, useMemo, type ReactElement } from 'react'
import { Clock, Play, Pencil, Trash2, Check, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { SidebarMenuButton } from '@renderer/components/ui/sidebar'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@renderer/components/ui/dialog'
import { useScheduledTasks, type ScheduledTaskView } from '@renderer/hooks/useScheduledTasks'

interface SchedulerPopoverProps {
  workspaceId: string | null
}

function relativeTime(dateStr: string | null, now: number): string {
  if (!dateStr) return 'Never'
  const elapsed = now - new Date(dateStr).getTime()
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function relativeTimeFuture(dateStr: string | null, now: number): string {
  if (!dateStr) return ''
  const remaining = new Date(dateStr).getTime() - now
  if (remaining <= 0) return 'due now'
  const minutes = Math.floor(remaining / 60000)
  if (minutes < 1) return 'in <1m'
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours}h`
  const days = Math.floor(hours / 24)
  return `in ${days}d`
}

export function SchedulerPopover({ workspaceId }: SchedulerPopoverProps): ReactElement | null {
  const { tasks, runningIds, toggle, update, remove, runNow } = useScheduledTasks(workspaceId)

  const [now, setNow] = useState(Date.now)
  const [editingTask, setEditingTask] = useState<ScheduledTaskView | null>(null)

  // Refresh relative timestamps every 30 seconds
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return (): void => clearInterval(id)
  }, [])

  const hasRecentRun = useMemo(
    () =>
      tasks.some((t) => {
        if (!t.last_run_at) return false
        const elapsed = now - new Date(t.last_run_at).getTime()
        return elapsed < 5 * 60 * 1000
      }),
    [tasks, now]
  )

  const hasRunning = runningIds.size > 0

  return (
    <>
      <Tooltip delayDuration={500}>
        <Popover>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <SidebarMenuButton size="sm">
                <div className="relative">
                  {hasRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}
                  {!hasRunning && hasRecentRun && (
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  )}
                </div>
                <span className="group-data-[collapsible=icon]:hidden">Scheduled Tasks</span>
                {tasks.length > 0 && (
                  <span className="ml-auto text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                    {tasks.length}
                  </span>
                )}
              </SidebarMenuButton>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">Automate recurring AI tasks on a schedule</TooltipContent>
          <PopoverContent side="right" align="end" className="w-80 p-0">
            <div className="px-3 py-2 border-b border-border">
              <h3 className="text-sm font-medium">Scheduled Tasks</h3>
              <p className="text-xs text-muted-foreground">
                {tasks.length === 0
                  ? 'No tasks scheduled'
                  : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
              </p>
            </div>

            {tasks.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No scheduled tasks. Ask the assistant to set one up.
              </div>
            ) : (
              <ScrollArea className="max-h-80">
                <div className="p-1">
                  {tasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      now={now}
                      isRunning={runningIds.has(task.id)}
                      onToggle={toggle}
                      onEdit={setEditingTask}
                      onDelete={remove}
                      onRunNow={runNow}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </PopoverContent>
        </Popover>
      </Tooltip>

      <EditTaskDialog task={editingTask} onClose={() => setEditingTask(null)} onSave={update} />
    </>
  )
}

// ─── Task item in the popover list ──────────────────────────

function TaskItem({
  task,
  now,
  isRunning,
  onToggle,
  onEdit,
  onDelete,
  onRunNow
}: {
  task: ScheduledTaskView
  now: number
  isRunning: boolean
  onToggle: (id: string, enabled: boolean) => Promise<void>
  onEdit: (task: ScheduledTaskView) => void
  onDelete: (id: string) => Promise<void>
  onRunNow: (id: string) => Promise<void>
}): ReactElement {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isEnabled = task.enabled === 1

  const handleDelete = async (): Promise<void> => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    await onDelete(task.id)
    setConfirmDelete(false)
  }

  return (
    <div className="rounded-md hover:bg-accent/50 p-2 m-1 group/task">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isRunning && <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />}
            <p
              className={`text-xs font-medium line-clamp-2 break-words ${!isEnabled ? 'text-muted-foreground' : ''}`}
            >
              {task.name}
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground">{task.schedule_description}</p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/task:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => onRunNow(task.id)}
            disabled={isRunning}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            title={isRunning ? 'Task is running' : 'Run now'}
          >
            {isRunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onEdit(task)}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className={`p-1 rounded hover:bg-accent ${confirmDelete ? 'text-red-500' : 'text-muted-foreground hover:text-foreground'}`}
            title={confirmDelete ? 'Click again to confirm' : 'Delete'}
            onBlur={() => setConfirmDelete(false)}
          >
            {confirmDelete ? <Check className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {isRunning && <span className="text-blue-500">Running...</span>}
          {!isRunning && task.last_run_at && (
            <>
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${task.last_run_status === 'success' ? 'bg-green-500' : task.last_run_status === 'error' ? 'bg-red-500' : 'bg-muted-foreground'}`}
              />
              <span>{relativeTime(task.last_run_at, now)}</span>
            </>
          )}
          {!isRunning && !task.last_run_at && <span>Not yet run</span>}
          {!isRunning && task.next_run_at && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span>Next {relativeTimeFuture(task.next_run_at, now)}</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => onToggle(task.id, !isEnabled)}
          className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${isEnabled ? 'bg-green-500/20 text-green-600 hover:bg-green-500/30' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
        >
          {isEnabled ? 'On' : 'Off'}
        </button>
      </div>
    </div>
  )
}

// ─── Schedule picker helpers ────────────────────────────────

type Frequency = 'daily' | 'weekdays' | 'weekends' | 'specific_days' | 'interval_minutes'

interface Schedule {
  frequency: Frequency
  hour: number
  minute: number
  days: number[]
  interval: number
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays (Mon-Fri)' },
  { value: 'weekends', label: 'Weekends (Sat-Sun)' },
  { value: 'specific_days', label: 'Specific days' },
  { value: 'interval_minutes', label: 'Every N minutes' }
]

function parseCronToSchedule(cron: string): Schedule {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return { frequency: 'daily', hour: 8, minute: 0, days: [], interval: 30 }

  const [minF, hourF, , , dowF] = fields

  // Every N minutes: */N * * * *
  const everyMin = minF.match(/^\*\/(\d+)$/)
  if (everyMin && hourF === '*') {
    return {
      frequency: 'interval_minutes',
      hour: 8,
      minute: 0,
      days: [],
      interval: parseInt(everyMin[1], 10)
    }
  }

  // Every N hours: 0 */N * * *
  const everyHour = hourF.match(/^\*\/(\d+)$/)
  if (everyHour) {
    return {
      frequency: 'interval_minutes',
      hour: 8,
      minute: 0,
      days: [],
      interval: parseInt(everyHour[1], 10) * 60
    }
  }

  const minute = parseInt(minF, 10)
  const hour = parseInt(hourF, 10)
  const m = isNaN(minute) ? 0 : minute
  const h = isNaN(hour) ? 8 : hour

  if (dowF === '1-5') {
    return { frequency: 'weekdays', hour: h, minute: m, days: [], interval: 30 }
  }
  if (dowF === '0,6' || dowF === '6,0') {
    return { frequency: 'weekends', hour: h, minute: m, days: [], interval: 30 }
  }
  if (dowF !== '*') {
    const days = dowF
      .split(',')
      .map((d) => parseInt(d.trim(), 10))
      .filter((d) => !isNaN(d))
    if (days.length > 0) {
      return { frequency: 'specific_days', hour: h, minute: m, days, interval: 30 }
    }
  }

  return { frequency: 'daily', hour: h, minute: m, days: [], interval: 30 }
}

function scheduleToCron(s: Schedule): string {
  if (s.frequency === 'interval_minutes') {
    if (s.interval < 60) return `*/${s.interval} * * * *`
    const hours = Math.round(s.interval / 60)
    return `0 */${hours} * * *`
  }

  const m = s.minute
  const h = s.hour

  switch (s.frequency) {
    case 'daily':
      return `${m} ${h} * * *`
    case 'weekdays':
      return `${m} ${h} * * 1-5`
    case 'weekends':
      return `${m} ${h} * * 0,6`
    case 'specific_days':
      return `${m} ${h} * * ${s.days.length > 0 ? s.days.join(',') : '*'}`
    default:
      return `${m} ${h} * * *`
  }
}

function describeSchedule(s: Schedule): string {
  if (s.frequency === 'interval_minutes') {
    if (s.interval < 60) return `Every ${s.interval} minutes`
    const hours = Math.round(s.interval / 60)
    return hours === 1 ? 'Every hour' : `Every ${hours} hours`
  }

  const hour = s.hour
  const minute = s.minute
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  const time = `${h12}:${minute.toString().padStart(2, '0')} ${ampm}`

  switch (s.frequency) {
    case 'daily':
      return `Every day at ${time}`
    case 'weekdays':
      return `Weekdays at ${time}`
    case 'weekends':
      return `Weekends at ${time}`
    case 'specific_days': {
      if (s.days.length === 0) return `Every day at ${time}`
      const names = s.days.map((d) => DAY_LABELS[d]).join(', ')
      return `${names} at ${time}`
    }
    default:
      return `Every day at ${time}`
  }
}

// ─── Edit dialog ────────────────────────────────────────────

const selectClass =
  'text-sm px-3 py-2 rounded-md border border-border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring appearance-none cursor-pointer'

function EditTaskDialog({
  task,
  onClose,
  onSave
}: {
  task: ScheduledTaskView | null
  onClose: () => void
  onSave: (
    id: string,
    changes: { name?: string; prompt?: string; cron_expression?: string }
  ) => Promise<void>
}): ReactElement {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [schedule, setSchedule] = useState<Schedule>({
    frequency: 'daily',
    hour: 8,
    minute: 0,
    days: [],
    interval: 30
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (task) {
      setName(task.name)
      setPrompt(task.prompt)
      setSchedule(parseCronToSchedule(task.cron_expression))
    }
  }, [task])

  const preview = describeSchedule(schedule)

  const handleSave = async (): Promise<void> => {
    if (!task || !name.trim()) return
    setSaving(true)
    try {
      await onSave(task.id, {
        name,
        prompt,
        cron_expression: scheduleToCron(schedule)
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const updateSchedule = (patch: Partial<Schedule>): void => {
    setSchedule((prev) => ({ ...prev, ...patch }))
  }

  const toggleDay = (day: number): void => {
    setSchedule((prev) => {
      const has = prev.days.includes(day)
      const days = has ? prev.days.filter((d) => d !== day) : [...prev.days, day].sort()
      return { ...prev, days }
    })
  }

  const showTimePicker = schedule.frequency !== 'interval_minutes'

  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Edit Scheduled Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-md border border-border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
              placeholder="Task name"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-md border border-border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring resize-none"
              rows={5}
              placeholder="What should the agent do each time this task runs?"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">
              Scheduled Time
            </label>

            <div className="space-y-3">
              {/* Frequency */}
              <select
                value={schedule.frequency}
                onChange={(e) => updateSchedule({ frequency: e.target.value as Frequency })}
                className={`w-full ${selectClass}`}
              >
                {FREQUENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {/* Day toggles for specific_days */}
              {schedule.frequency === 'specific_days' && (
                <div className="flex gap-1">
                  {DAY_LABELS.map((label, i) => {
                    const active = schedule.days.includes(i)
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleDay(i)}
                        className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Time picker */}
              {showTimePicker && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">at</span>
                  <select
                    value={schedule.hour}
                    onChange={(e) => updateSchedule({ hour: parseInt(e.target.value, 10) })}
                    className={selectClass}
                  >
                    {Array.from({ length: 24 }, (_, i) => {
                      const ampm = i >= 12 ? 'PM' : 'AM'
                      const h12 = i === 0 ? 12 : i > 12 ? i - 12 : i
                      return (
                        <option key={i} value={i}>
                          {h12} {ampm}
                        </option>
                      )
                    })}
                  </select>
                  <span className="text-xs text-muted-foreground">:</span>
                  <select
                    value={schedule.minute}
                    onChange={(e) => updateSchedule({ minute: parseInt(e.target.value, 10) })}
                    className={selectClass}
                  >
                    {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                      <option key={m} value={m}>
                        {m.toString().padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Interval picker */}
              {schedule.frequency === 'interval_minutes' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">every</span>
                  <select
                    value={schedule.interval}
                    onChange={(e) => updateSchedule({ interval: parseInt(e.target.value, 10) })}
                    className={selectClass}
                  >
                    {[5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720].map((m) => (
                      <option key={m} value={m}>
                        {m < 60
                          ? `${m} min`
                          : m === 60
                            ? '1 hour'
                            : m % 60 === 0
                              ? `${m / 60} hours`
                              : `${m} min`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Preview */}
              <p className="text-xs text-muted-foreground">{preview}</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent text-muted-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
