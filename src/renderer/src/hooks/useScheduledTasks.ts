import { useState, useEffect, useCallback } from 'react'

export interface ScheduledTaskView {
  id: string
  workspace_id: string
  name: string
  prompt: string
  cron_expression: string
  enabled: number
  last_run_at: string | null
  last_run_status: string | null
  next_run_at: string | null
  created_at: string
  schedule_description: string
}

interface UseScheduledTasksResult {
  tasks: ScheduledTaskView[]
  loading: boolean
  runningIds: Set<string>
  toggle: (id: string, enabled: boolean) => Promise<void>
  update: (
    id: string,
    changes: { name?: string; prompt?: string; cron_expression?: string }
  ) => Promise<void>
  remove: (id: string) => Promise<void>
  runNow: (id: string) => Promise<void>
}

export function useScheduledTasks(workspaceId?: string | null): UseScheduledTasksResult {
  const [tasks, setTasks] = useState<ScheduledTaskView[]>([])
  const [loading, setLoading] = useState(true)
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setTasks([])
      setLoading(false)
      return
    }
    try {
      const result = (await window.api.scheduler.list(workspaceId)) as ScheduledTaskView[]
      setTasks(result)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    refresh()
    const unsub = window.api.onSchedulerChanged(() => {
      refresh()
    })
    return unsub
  }, [refresh])

  // Track running tasks via IPC events
  useEffect(() => {
    const unsub = window.api.onTaskRunning((data) => {
      setRunningIds((prev) => {
        const next = new Set(prev)
        if (data.running) {
          next.add(data.taskId)
        } else {
          next.delete(data.taskId)
        }
        return next
      })
    })
    return unsub
  }, [])

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      await window.api.scheduler.toggle(id, enabled)
      await refresh()
    },
    [refresh]
  )

  const update = useCallback(
    async (id: string, changes: { name?: string; prompt?: string; cron_expression?: string }) => {
      await window.api.scheduler.update(id, changes)
      await refresh()
    },
    [refresh]
  )

  const remove = useCallback(
    async (id: string) => {
      await window.api.scheduler.delete(id)
      await refresh()
    },
    [refresh]
  )

  const runNow = useCallback(async (id: string) => {
    await window.api.scheduler.runNow(id)
  }, [])

  return { tasks, loading, runningIds, toggle, update, remove, runNow }
}
