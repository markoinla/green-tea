import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { runMigrations } from './migrations'
import { pruneAgentLogs } from './repositories/agent-logs'

let db: Database.Database | null = null

export function getDatabase(dbPath?: string): Database.Database {
  if (db) return db

  const path = dbPath ?? join(app.getPath('userData'), 'greentea.db')
  db = new Database(path)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  // Housekeeping: agent_logs grows with every proposal; drop resolved rows
  // (applied/rejected/stale) older than 30 days. Pending rows are kept.
  pruneAgentLogs(db)

  return db
}
