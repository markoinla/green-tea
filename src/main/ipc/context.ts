import { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'

export interface IpcHandlerContext {
  db: Database.Database
  mainWindow?: BrowserWindow
}

export function getMainWindow(mainWindow?: BrowserWindow): BrowserWindow | null {
  return mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null
}
