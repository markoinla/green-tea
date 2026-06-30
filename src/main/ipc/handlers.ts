import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { registerDbHandlers } from './register-db-handlers'
import { registerAgentHandlers } from './register-agent-handlers'
import { registerSkillsHandlers } from './register-skills-handlers'
import { registerPluginHandlers } from './register-plugin-handlers'
import { registerWorkspaceFileHandlers } from './register-workspace-file-handlers'
import { registerSystemHandlers } from './register-system-handlers'
import { registerSchedulerHandlers } from './register-scheduler-handlers'
import { registerMcpHandlers } from './register-mcp-handlers'
import { registerGoogleHandlers } from './register-google-handlers'
import { registerMicrosoftHandlers } from './register-microsoft-handlers'
import { registerShareHandlers } from './register-share-handlers'
import { registerGitHandlers } from './register-git-handlers'
import { registerLlmAuthHandlers } from './register-llm-auth-handlers'

export function registerIpcHandlers(db: Database.Database, mainWindow?: BrowserWindow): void {
  const context = { db, mainWindow }

  registerDbHandlers(context)
  registerGitHandlers(context)
  registerAgentHandlers(context)
  registerSkillsHandlers(context)
  registerPluginHandlers(context)
  registerWorkspaceFileHandlers(context)
  registerSystemHandlers(context)
  registerSchedulerHandlers(context)
  registerMcpHandlers(context)
  registerGoogleHandlers(context)
  registerMicrosoftHandlers(context)
  registerLlmAuthHandlers(context)
  registerShareHandlers(context)
}
