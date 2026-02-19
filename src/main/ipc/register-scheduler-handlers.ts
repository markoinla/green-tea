import { ipcMain } from 'electron'
import * as scheduledTasks from '../database/repositories/scheduled-tasks'
import { executeScheduledTask } from '../scheduler/executor'
import { describeCron, getNextCronTime } from '../scheduler/cron'
import type { IpcHandlerContext } from './context'
import { getMainWindow } from './context'

export function registerSchedulerHandlers({ db, mainWindow }: IpcHandlerContext): void {
  ipcMain.handle('scheduler:list', (_event, workspaceId: string) => {
    const tasks = scheduledTasks.listScheduledTasks(db, workspaceId)
    return tasks.map((t) => ({
      ...t,
      schedule_description: describeCron(t.cron_expression)
    }))
  })

  ipcMain.handle('scheduler:get', (_event, id: string) => {
    const task = scheduledTasks.getScheduledTask(db, id)
    if (!task) return null
    const runs = scheduledTasks.listTaskRuns(db, id, 20)
    return {
      ...task,
      schedule_description: describeCron(task.cron_expression),
      runs
    }
  })

  ipcMain.handle('scheduler:toggle', (_event, id: string, enabled: boolean) => {
    const task = scheduledTasks.getScheduledTask(db, id)
    const nextRunAt =
      enabled && task
        ? (getNextCronTime(task.cron_expression, new Date())?.toISOString() ?? null)
        : null
    scheduledTasks.updateScheduledTask(db, id, { enabled: enabled ? 1 : 0, next_run_at: nextRunAt })
    mainWindow?.webContents.send('scheduler:changed')
  })

  ipcMain.handle(
    'scheduler:update',
    (_event, id: string, changes: { name?: string; prompt?: string; cron_expression?: string }) => {
      if (changes.cron_expression) {
        const next = getNextCronTime(changes.cron_expression, new Date())
        scheduledTasks.updateScheduledTask(db, id, {
          ...changes,
          next_run_at: next?.toISOString() ?? null
        })
      } else {
        scheduledTasks.updateScheduledTask(db, id, changes)
      }
      mainWindow?.webContents.send('scheduler:changed')
    }
  )

  ipcMain.handle('scheduler:delete', (_event, id: string) => {
    scheduledTasks.deleteScheduledTask(db, id)
    mainWindow?.webContents.send('scheduler:changed')
  })

  ipcMain.handle('scheduler:run-now', async (_event, id: string) => {
    const task = scheduledTasks.getScheduledTask(db, id)
    if (!task) throw new Error(`Task not found: ${id}`)
    const window = getMainWindow(mainWindow)
    if (!window) throw new Error('No browser window available')
    executeScheduledTask(db, window, task).then(() => {
      mainWindow?.webContents.send('scheduler:changed')
    })
  })
}
