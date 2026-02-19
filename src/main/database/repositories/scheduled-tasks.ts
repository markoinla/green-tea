import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { ScheduledTask, ScheduledTaskRun } from '../types'

export function listScheduledTasks(db: Database.Database, workspaceId?: string): ScheduledTask[] {
  if (workspaceId) {
    return db
      .prepare('SELECT * FROM scheduled_tasks WHERE workspace_id = ? ORDER BY created_at ASC')
      .all(workspaceId) as ScheduledTask[]
  }
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at ASC')
    .all() as ScheduledTask[]
}

export function getScheduledTask(db: Database.Database, id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined
}

export function createScheduledTask(
  db: Database.Database,
  data: {
    workspace_id: string
    name: string
    prompt: string
    cron_expression: string
  }
): ScheduledTask {
  const id = randomUUID()
  db.prepare(
    'INSERT INTO scheduled_tasks (id, workspace_id, name, prompt, cron_expression) VALUES (?, ?, ?, ?, ?)'
  ).run(id, data.workspace_id, data.name, data.prompt, data.cron_expression)
  return getScheduledTask(db, id)!
}

export function updateScheduledTask(
  db: Database.Database,
  id: string,
  data: {
    name?: string
    prompt?: string
    cron_expression?: string
    enabled?: number
    last_run_at?: string
    last_run_status?: string
    next_run_at?: string | null
  }
): ScheduledTask {
  const task = getScheduledTask(db, id)
  if (!task) throw new Error(`Scheduled task not found: ${id}`)

  const fields: string[] = []
  const values: unknown[] = []

  if (data.name !== undefined) {
    fields.push('name = ?')
    values.push(data.name)
  }
  if (data.prompt !== undefined) {
    fields.push('prompt = ?')
    values.push(data.prompt)
  }
  if (data.cron_expression !== undefined) {
    fields.push('cron_expression = ?')
    values.push(data.cron_expression)
  }
  if (data.enabled !== undefined) {
    fields.push('enabled = ?')
    values.push(data.enabled)
  }
  if (data.last_run_at !== undefined) {
    fields.push('last_run_at = ?')
    values.push(data.last_run_at)
  }
  if (data.last_run_status !== undefined) {
    fields.push('last_run_status = ?')
    values.push(data.last_run_status)
  }
  if (data.next_run_at !== undefined) {
    fields.push('next_run_at = ?')
    values.push(data.next_run_at)
  }

  if (fields.length > 0) {
    values.push(id)
    db.prepare(`UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  return getScheduledTask(db, id)!
}

export function deleteScheduledTask(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
}

export function listTaskRuns(
  db: Database.Database,
  taskId: string,
  limit: number = 20
): ScheduledTaskRun[] {
  return db
    .prepare('SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?')
    .all(taskId, limit) as ScheduledTaskRun[]
}

export function createTaskRun(
  db: Database.Database,
  data: {
    task_id: string
    status: string
    started_at: string
  }
): ScheduledTaskRun {
  const id = randomUUID()
  db.prepare(
    'INSERT INTO scheduled_task_runs (id, task_id, status, started_at) VALUES (?, ?, ?, ?)'
  ).run(id, data.task_id, data.status, data.started_at)
  return db.prepare('SELECT * FROM scheduled_task_runs WHERE id = ?').get(id) as ScheduledTaskRun
}

export function updateTaskRun(
  db: Database.Database,
  id: string,
  data: {
    status?: string
    result?: string
    tokens_used?: number
    finished_at?: string
    error_message?: string
  }
): void {
  const fields: string[] = []
  const values: unknown[] = []

  if (data.status !== undefined) {
    fields.push('status = ?')
    values.push(data.status)
  }
  if (data.result !== undefined) {
    fields.push('result = ?')
    values.push(data.result)
  }
  if (data.tokens_used !== undefined) {
    fields.push('tokens_used = ?')
    values.push(data.tokens_used)
  }
  if (data.finished_at !== undefined) {
    fields.push('finished_at = ?')
    values.push(data.finished_at)
  }
  if (data.error_message !== undefined) {
    fields.push('error_message = ?')
    values.push(data.error_message)
  }

  if (fields.length === 0) return

  values.push(id)
  db.prepare(`UPDATE scheduled_task_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function pruneTaskRuns(db: Database.Database, taskId: string, keep: number = 20): void {
  db.prepare(
    `DELETE FROM scheduled_task_runs
     WHERE task_id = ? AND id NOT IN (
       SELECT id FROM scheduled_task_runs
       WHERE task_id = ?
       ORDER BY started_at DESC LIMIT ?
     )`
  ).run(taskId, taskId, keep)
}
