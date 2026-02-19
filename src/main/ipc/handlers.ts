import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { registerDbHandlers } from './register-db-handlers'
import { registerAgentHandlers } from './register-agent-handlers'
import { registerSkillsHandlers } from './register-skills-handlers'
import { registerWorkspaceFileHandlers } from './register-workspace-file-handlers'
import { registerSystemHandlers } from './register-system-handlers'
import { registerSchedulerHandlers } from './register-scheduler-handlers'
import { registerMcpHandlers } from './register-mcp-handlers'
import { registerGoogleHandlers } from './register-google-handlers'
import { registerMicrosoftHandlers } from './register-microsoft-handlers'

export function registerIpcHandlers(db: Database.Database, mainWindow?: BrowserWindow): void {
  const context = { db, mainWindow }

  registerDbHandlers(context)
  registerAgentHandlers(context)
  registerSkillsHandlers(context)
  registerWorkspaceFileHandlers(context)
  registerSystemHandlers(context)
  registerSchedulerHandlers(context)
  registerMcpHandlers(context)
  registerGoogleHandlers(context)
  registerMicrosoftHandlers(context)
}
