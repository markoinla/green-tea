import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { mkdirSync } from 'fs'
import {
  createAgentSession,
  SessionManager,
  DefaultResourceLoader,
  loadSkillsFromDir,
  createCodingTools
} from '@mariozechner/pi-coding-agent'
import { getModelConfig } from '../agent/session'
import { createNotesTools } from '../agent/tools/notes-tools'
import { getAgentBaseDir, getAgentWorkDir } from '../agent/paths'
import { getSkillsDir } from '../skills/manager'
import { getSetting } from '../database/repositories/settings'
import { getWorkspace } from '../database/repositories/workspaces'
import {
  updateScheduledTask,
  createTaskRun,
  updateTaskRun,
  pruneTaskRuns
} from '../database/repositories/scheduled-tasks'
import type { ScheduledTask } from '../database/types'
import {
  loadSandboxConfig,
  initializeSandbox,
  createSandboxedBashOps,
  isSandboxInitialized
} from '../agent/sandbox'
import { buildSystemPrompt } from '../agent/system-prompt'

export async function executeScheduledTask(
  db: Database.Database,
  window: BrowserWindow,
  task: ScheduledTask
): Promise<void> {
  const startedAt = new Date().toISOString()

  // Notify renderer that task is running
  if (!window.isDestroyed()) {
    window.webContents.send('scheduler:task-running', { taskId: task.id, running: true })
  }

  try {
    const { model, authStorage } = getModelConfig(db)
    const reasoningMode = getSetting(db, 'reasoningMode') === 'true'

    const customTools = createNotesTools(db, window, task.workspace_id, true)

    const agentWorkDir = getAgentWorkDir(db, task.workspace_id)
    mkdirSync(agentWorkDir, { recursive: true })

    const agentBaseDir = getAgentBaseDir(db)
    const sandboxConfig = loadSandboxConfig(agentBaseDir)
    await initializeSandbox(sandboxConfig)

    const toolsOptions = isSandboxInitialized()
      ? { bash: { operations: createSandboxedBashOps() } }
      : undefined

    const skillsDir = getSkillsDir(db)
    const disabledRaw = getSetting(db, 'disabledSkills')
    const disabledSkills: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
    const resourceLoader = new DefaultResourceLoader({
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: buildSystemPrompt(agentWorkDir),
      skillsOverride: () => {
        const { skills, diagnostics } = loadSkillsFromDir({ dir: skillsDir, source: 'user' })
        return { skills: skills.filter((s) => !disabledSkills.includes(s.name)), diagnostics }
      }
    })
    await resourceLoader.reload()

    const { session } = await createAgentSession({
      cwd: agentWorkDir,
      model,
      tools: createCodingTools(agentWorkDir, toolsOptions),
      customTools,
      authStorage,
      sessionManager: SessionManager.inMemory(),
      resourceLoader,
      thinkingLevel: reasoningMode ? 'medium' : 'off'
    })

    // Build prompt with workspace context
    let fullPrompt = task.prompt

    // Add date/time context
    const now = new Date()
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const dateStr = now.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    })
    fullPrompt = `[Current time: ${dateStr} (${timezone})]\n\n${fullPrompt}`

    const workspace = getWorkspace(db, task.workspace_id)
    if (workspace) {
      if (workspace.memory) {
        fullPrompt = `[Workspace Memory:\n${workspace.memory}]\n\n${fullPrompt}`
      }
      if (workspace.description) {
        fullPrompt = `[Workspace Context — "${workspace.name}":\n${workspace.description}]\n\n${fullPrompt}`
      }
    }

    await session.prompt(fullPrompt)

    const finishedAt = new Date().toISOString()

    // Log success
    const run = createTaskRun(db, {
      task_id: task.id,
      status: 'success',
      started_at: startedAt
    })
    updateTaskRun(db, run.id, {
      result: 'Task completed successfully',
      finished_at: finishedAt
    })

    updateScheduledTask(db, task.id, {
      last_run_at: finishedAt,
      last_run_status: 'success'
    })

    // Notify renderer
    if (!window.isDestroyed()) {
      window.webContents.send('scheduler:task-completed', {
        taskId: task.id,
        name: task.name,
        status: 'success'
      })
    }

    session.dispose()
  } catch (err) {
    const finishedAt = new Date().toISOString()
    const errorMessage = err instanceof Error ? err.message : String(err)

    const run = createTaskRun(db, {
      task_id: task.id,
      status: 'error',
      started_at: startedAt
    })
    updateTaskRun(db, run.id, {
      error_message: errorMessage,
      finished_at: finishedAt
    })

    updateScheduledTask(db, task.id, {
      last_run_at: finishedAt,
      last_run_status: 'error'
    })

    if (!window.isDestroyed()) {
      window.webContents.send('scheduler:task-completed', {
        taskId: task.id,
        name: task.name,
        status: 'error',
        error: errorMessage
      })
    }
  }

  // Notify renderer that task is no longer running
  if (!window.isDestroyed()) {
    window.webContents.send('scheduler:task-running', { taskId: task.id, running: false })
  }

  // Prune old runs
  pruneTaskRuns(db, task.id, 20)
}
