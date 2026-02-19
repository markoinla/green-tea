import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../__test__/setup'
import {
  listScheduledTasks,
  getScheduledTask,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  listTaskRuns,
  createTaskRun,
  updateTaskRun,
  pruneTaskRuns
} from './scheduled-tasks'
import { createWorkspace } from './workspaces'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

function makeWorkspace() {
  return createWorkspace(db, { name: 'Test' })
}

describe('scheduled-tasks repository', () => {
  it('creates and retrieves a task', () => {
    const ws = makeWorkspace()
    const task = createScheduledTask(db, {
      workspace_id: ws.id,
      name: 'Daily Summary',
      prompt: 'Summarize everything',
      cron_expression: '0 9 * * *'
    })

    expect(task.name).toBe('Daily Summary')
    expect(task.cron_expression).toBe('0 9 * * *')
    expect(task.enabled).toBe(1)

    const fetched = getScheduledTask(db, task.id)
    expect(fetched).toBeDefined()
    expect(fetched!.name).toBe('Daily Summary')
  })

  it('lists tasks filtered by workspace', () => {
    const ws1 = makeWorkspace()
    const ws2 = makeWorkspace()
    createScheduledTask(db, {
      workspace_id: ws1.id,
      name: 'T1',
      prompt: 'p1',
      cron_expression: '* * * * *'
    })
    createScheduledTask(db, {
      workspace_id: ws2.id,
      name: 'T2',
      prompt: 'p2',
      cron_expression: '* * * * *'
    })

    const tasks = listScheduledTasks(db, ws1.id)
    expect(tasks.length).toBe(1)
    expect(tasks[0].name).toBe('T1')
  })

  it('lists all tasks without filter', () => {
    const ws = makeWorkspace()
    createScheduledTask(db, {
      workspace_id: ws.id,
      name: 'T1',
      prompt: 'p',
      cron_expression: '* * * * *'
    })
    const all = listScheduledTasks(db)
    expect(all.length).toBeGreaterThanOrEqual(1)
  })

  it('updates task fields', () => {
    const ws = makeWorkspace()
    const task = createScheduledTask(db, {
      workspace_id: ws.id,
      name: 'Old',
      prompt: 'old prompt',
      cron_expression: '0 0 * * *'
    })

    const updated = updateScheduledTask(db, task.id, {
      name: 'New',
      prompt: 'new prompt',
      enabled: 0,
      cron_expression: '0 12 * * *'
    })

    expect(updated.name).toBe('New')
    expect(updated.prompt).toBe('new prompt')
    expect(updated.enabled).toBe(0)
    expect(updated.cron_expression).toBe('0 12 * * *')
  })

  it('throws when updating nonexistent task', () => {
    expect(() => updateScheduledTask(db, 'nope', { name: 'X' })).toThrow(
      'Scheduled task not found'
    )
  })

  it('deletes a task', () => {
    const ws = makeWorkspace()
    const task = createScheduledTask(db, {
      workspace_id: ws.id,
      name: 'Del',
      prompt: 'p',
      cron_expression: '* * * * *'
    })
    deleteScheduledTask(db, task.id)
    expect(getScheduledTask(db, task.id)).toBeUndefined()
  })
})

describe('task runs', () => {
  it('creates and lists runs', () => {
    const ws = makeWorkspace()
    const task = createScheduledTask(db, {
      workspace_id: ws.id,
      name: 'T',
      prompt: 'p',
      cron_expression: '* * * * *'
    })

    const run = createTaskRun(db, {
      task_id: task.id,
      status: 'running',
      started_at: new Date().toISOString()
    })

    expect(run.status).toBe('running')
    expect(run.task_id).toBe(task.id)

    const runs = listTaskRuns(db, task.id)
    expect(runs.length).toBe(1)
  })

  it('updates run fields', () => {
    const ws = makeWorkspace()
    const task = createScheduledTask(db, {
      workspace_id: ws.id,
      name: 'T',
      prompt: 'p',
      cron_expression: '* * * * *'
    })
    const run = createTaskRun(db, {
      task_id: task.id,
      status: 'running',
      started_at: new Date().toISOString()
    })

    updateTaskRun(db, run.id, {
      status: 'completed',
      result: 'done',
      tokens_used: 1500,
      finished_at: new Date().toISOString()
    })

    const runs = listTaskRuns(db, task.id)
    expect(runs[0].status).toBe('completed')
    expect(runs[0].result).toBe('done')
    expect(runs[0].tokens_used).toBe(1500)
    expect(runs[0].finished_at).toBeDefined()
  })

  it('prunes old runs keeping only the specified number', () => {
    const ws = makeWorkspace()
    const task = createScheduledTask(db, {
      workspace_id: ws.id,
      name: 'T',
      prompt: 'p',
      cron_expression: '* * * * *'
    })

    for (let i = 0; i < 5; i++) {
      createTaskRun(db, {
        task_id: task.id,
        status: 'completed',
        started_at: new Date(Date.now() + i * 1000).toISOString()
      })
    }

    pruneTaskRuns(db, task.id, 2)

    const remaining = listTaskRuns(db, task.id)
    expect(remaining.length).toBe(2)
  })
})
