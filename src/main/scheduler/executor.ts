import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { Notification } from 'electron'
import { mkdirSync } from 'fs'
import {
  createAgentSession,
  SessionManager,
  DefaultResourceLoader,
  loadSkillsFromDir,
  createBashToolDefinition
} from '@earendil-works/pi-coding-agent'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { getModelConfig } from '../agent/session'
import { createNotesTools } from '../agent/tools/notes-tools'
import { getAgentBaseDir, getAgentWorkDir, getWorkspaceDir } from '../agent/paths'
import { getSkillsDir } from '../skills/manager'
import { getSetting } from '../database/repositories/settings'
import { getWorkspace } from '../database/repositories/workspaces'
import { readWorkspaceDoc } from '../vault/workspace-docs'
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

function notifyBackground(
  window: BrowserWindow,
  task: ScheduledTask,
  ok: boolean,
  error?: string
): void {
  // The window can be destroyed mid-run (e.g. Cmd-Q during a long prompt). Bail
  // before touching it — isVisible()/webContents would throw on a destroyed window.
  if (window.isDestroyed()) return
  if (window.isVisible()) return // in-app toast already covers this
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: ok ? `✓ ${task.name}` : `⚠︎ ${task.name} failed`,
    body: ok ? 'Scheduled task completed.' : (error ?? 'Scheduled task failed.')
  })
  n.on('click', () => {
    if (!window.isDestroyed()) {
      window.show()
      window.webContents.send('scheduler:open-run', { taskId: task.id })
    }
  })
  n.show()
}

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
    const { model, authStorage } = getModelConfig(db, {
      provider: task.provider,
      model: task.model
    })
    const reasoningMode = getSetting(db, 'reasoningMode') === 'true'

    const customTools = createNotesTools(db, window, task.workspace_id, true)

    const agentWorkDir = getAgentWorkDir(db, task.workspace_id)
    mkdirSync(agentWorkDir, { recursive: true })

    const agentBaseDir = getAgentBaseDir(db)
    const workspaceVaultDir = getWorkspaceDir(db, task.workspace_id)
    const sandboxConfig = loadSandboxConfig(agentBaseDir, [workspaceVaultDir])
    await initializeSandbox(sandboxConfig)

    // Sandboxed bash shares the built-in tool name 'bash' so it overrides the built-in.
    const sandboxedBash: ToolDefinition[] = isSandboxInitialized()
      ? [
          createBashToolDefinition(agentWorkDir, {
            operations: createSandboxedBashOps()
          }) as ToolDefinition
        ]
      : []

    const skillsDir = getSkillsDir(db)
    const disabledRaw = getSetting(db, 'disabledSkills')
    const disabledSkills: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
    const resourceLoader = new DefaultResourceLoader({
      cwd: agentWorkDir,
      agentDir: agentBaseDir,
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
      // No `tools` allowlist (it would filter custom tools); keep default built-ins + all custom.
      customTools: [...sandboxedBash, ...customTools],
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
      const memory = readWorkspaceDoc(db, task.workspace_id, 'memory')
      const description = readWorkspaceDoc(db, task.workspace_id, 'description')
      if (memory) {
        fullPrompt = `[Workspace Memory:\n${memory}]\n\n${fullPrompt}`
      }
      if (description) {
        fullPrompt = `[Workspace Context — "${workspace.name}":\n${description}]\n\n${fullPrompt}`
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

    notifyBackground(window, task, true)

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

    notifyBackground(window, task, false, errorMessage)
  }

  // Notify renderer that task is no longer running
  if (!window.isDestroyed()) {
    window.webContents.send('scheduler:task-running', { taskId: task.id, running: false })
  }

  // Prune old runs
  pruneTaskRuns(db, task.id, 20)
}
