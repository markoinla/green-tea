import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import {
  createScheduledTask,
  updateScheduledTask
} from '../../database/repositories/scheduled-tasks'
import { isValidCron, describeCron, getNextCronTime } from '../../scheduler/cron'

export function createScheduledTaskTool(
  db: Database.Database,
  window: BrowserWindow,
  workspaceId: string
): ToolDefinition {
  return {
    name: 'create_scheduled_task',
    label: 'Create Scheduled Task',
    description:
      'Create a recurring scheduled task that runs automatically on a cron schedule. The task will execute the given prompt headlessly at the specified times.',
    parameters: Type.Object({
      name: Type.String({
        description: 'Short name for the task (e.g. "Morning briefing update")'
      }),
      prompt: Type.String({
        description: 'The instruction/prompt to execute each time the task runs'
      }),
      cron_expression: Type.String({
        description:
          'Cron expression (minute hour dayOfMonth month dayOfWeek). Example: "0 8 * * *" for daily at 8am'
      })
    }),
    async execute(_toolCallId, params) {
      const p = params as { name: string; prompt: string; cron_expression: string }

      if (!isValidCron(p.cron_expression)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Invalid cron expression "${p.cron_expression}". Use 5-field format: minute(0-59) hour(0-23) dayOfMonth(1-31) month(1-12) dayOfWeek(0-6, 0=Sunday).`
            }
          ],
          details: undefined
        }
      }

      const task = createScheduledTask(db, {
        workspace_id: workspaceId,
        name: p.name,
        prompt: p.prompt,
        cron_expression: p.cron_expression
      })

      const nextRun = getNextCronTime(p.cron_expression, new Date())
      if (nextRun) {
        updateScheduledTask(db, task.id, { next_run_at: nextRun.toISOString() })
      }

      if (!window.isDestroyed()) {
        window.webContents.send('scheduler:changed')
      }

      const schedule = describeCron(p.cron_expression)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Scheduled task created successfully.\n- Name: ${task.name}\n- Schedule: ${schedule}\n- Cron: ${p.cron_expression}\n- ID: ${task.id}`
          }
        ],
        details: undefined
      }
    }
  }
}
