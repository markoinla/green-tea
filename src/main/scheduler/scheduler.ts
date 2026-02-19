import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { listScheduledTasks, updateScheduledTask } from '../database/repositories/scheduled-tasks'
import type { ScheduledTask } from '../database/types'
import { cronMatchesNow, getNextCronTime } from './cron'
import { executeScheduledTask } from './executor'

const runningTasks = new Set<string>()
let intervalId: ReturnType<typeof setInterval> | null = null

function computeAndStoreNextRun(db: Database.Database, taskId: string, cron: string): void {
  const next = getNextCronTime(cron, new Date())
  updateScheduledTask(db, taskId, { next_run_at: next ? next.toISOString() : null })
}

function runTask(db: Database.Database, window: BrowserWindow, task: ScheduledTask): void {
  runningTasks.add(task.id)
  executeScheduledTask(db, window, task).finally(() => {
    computeAndStoreNextRun(db, task.id, task.cron_expression)
    runningTasks.delete(task.id)
    if (!window.isDestroyed()) {
      window.webContents.send('scheduler:changed')
    }
  })
}

function tick(db: Database.Database, window: BrowserWindow): void {
  const tasks = listScheduledTasks(db)
  const now = new Date()

  for (const task of tasks) {
    if (!task.enabled) continue
    if (runningTasks.has(task.id)) continue

    // Check if task is overdue (missed during sleep/suspend)
    if (task.next_run_at) {
      const nextRun = new Date(task.next_run_at)
      if (now >= nextRun) {
        runTask(db, window, task)
        continue
      }
    }

    if (!cronMatchesNow(task.cron_expression)) continue

    // Check if already ran this minute
    if (task.last_run_at) {
      const lastRun = new Date(task.last_run_at)
      if (
        lastRun.getFullYear() === now.getFullYear() &&
        lastRun.getMonth() === now.getMonth() &&
        lastRun.getDate() === now.getDate() &&
        lastRun.getHours() === now.getHours() &&
        lastRun.getMinutes() === now.getMinutes()
      ) {
        continue
      }
    }

    runTask(db, window, task)
  }
}

function catchUp(db: Database.Database, window: BrowserWindow): void {
  const tasks = listScheduledTasks(db)
  const now = new Date()

  for (const task of tasks) {
    if (!task.enabled) continue
    if (runningTasks.has(task.id)) continue

    // If next_run_at is set, only catch up if we're past that time
    if (task.next_run_at) {
      const nextRun = new Date(task.next_run_at)
      if (now >= nextRun) {
        runTask(db, window, task)
      }
      continue
    }

    // No next_run_at yet (legacy task or newly created) — compute it now
    // Only run if the cron matches right now, otherwise just seed next_run_at
    if (cronMatchesNow(task.cron_expression)) {
      runTask(db, window, task)
    } else {
      computeAndStoreNextRun(db, task.id, task.cron_expression)
    }
  }
}

export function startScheduler(db: Database.Database, window: BrowserWindow): { stop: () => void } {
  // Run catch-up on startup
  catchUp(db, window)

  // Tick every 60 seconds
  intervalId = setInterval(() => tick(db, window), 60 * 1000)

  return {
    stop(): void {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }
  }
}
