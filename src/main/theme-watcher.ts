import { readFileSync, writeFileSync, watch, existsSync, mkdirSync, type FSWatcher } from 'fs'
import { join, dirname } from 'path'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { getAgentBaseDir } from './agent/paths'

const THEME_FILENAME = 'theme.json'

const DEFAULT_THEME: ThemeData = {
  editorFontSize: '14',
  uiFontSize: '14',
  codeFontSize: '13',
  editorBodyFont: 'inter',
  editorHeadingFont: 'georgia',
  lightBackground: '#ffffff',
  darkBackground: '#3b3f3c',
  radius: '0.5rem',
  light: {
    background: 'oklch(1 0 0)',
    foreground: 'oklch(0.2 0.02 260)',
    card: 'oklch(1 0 0)',
    'card-foreground': 'oklch(0.2 0.02 260)',
    popover: 'oklch(1 0 0)',
    'popover-foreground': 'oklch(0.2 0.02 260)',
    primary: 'oklch(0.2 0.02 260)',
    'primary-foreground': 'oklch(0.98 0 0)',
    secondary: 'oklch(0.95 0.01 260)',
    'secondary-foreground': 'oklch(0.2 0.02 260)',
    muted: 'oklch(0.97 0.01 260)',
    'muted-foreground': 'oklch(0.55 0.02 260)',
    accent: 'oklch(0.96 0.01 260)',
    'accent-foreground': 'oklch(0.2 0.02 260)',
    destructive: 'oklch(0.6 0.2 20)',
    'destructive-foreground': 'oklch(0.98 0 0)',
    border: 'oklch(0.92 0.01 260)',
    input: 'oklch(0.92 0.01 260)',
    ring: 'oklch(0.2 0.02 260)',
    sidebar: 'oklch(0.99 0.005 260)',
    'sidebar-foreground': 'oklch(0.3 0.02 260)',
    'sidebar-primary': 'oklch(0.2 0.02 260)',
    'sidebar-primary-foreground': 'oklch(0.98 0 0)',
    'sidebar-accent': 'oklch(0.95 0.01 260)',
    'sidebar-accent-foreground': 'oklch(0.2 0.02 260)',
    'sidebar-border': 'oklch(0.92 0.01 260)',
    'sidebar-ring': 'oklch(0.2 0.02 260)'
  },
  dark: {
    background: 'oklch(0.255 0.008 155)',
    foreground: 'oklch(0.92 0.005 155)',
    card: 'oklch(0.275 0.008 155)',
    'card-foreground': 'oklch(0.92 0.005 155)',
    popover: 'oklch(0.275 0.008 155)',
    'popover-foreground': 'oklch(0.92 0.005 155)',
    primary: 'oklch(0.92 0.005 155)',
    'primary-foreground': 'oklch(0.255 0.008 155)',
    secondary: 'oklch(0.37 0.008 155)',
    'secondary-foreground': 'oklch(0.92 0.005 155)',
    muted: 'oklch(0.30 0.008 155)',
    'muted-foreground': 'oklch(0.65 0.008 155)',
    accent: 'oklch(0.30 0.008 155)',
    'accent-foreground': 'oklch(0.92 0.005 155)',
    destructive: 'oklch(0.4 0.15 20)',
    'destructive-foreground': 'oklch(0.92 0.005 155)',
    border: 'oklch(0.34 0.008 155)',
    input: 'oklch(0.34 0.008 155)',
    ring: 'oklch(0.6 0.15 150)',
    sidebar: 'oklch(0.275 0.008 155)',
    'sidebar-foreground': 'oklch(0.85 0.005 155)',
    'sidebar-primary': 'oklch(0.6 0.15 150)',
    'sidebar-primary-foreground': 'oklch(0.98 0 0)',
    'sidebar-accent': 'oklch(0.245 0.008 155)',
    'sidebar-accent-foreground': 'oklch(0.95 0.005 155)',
    'sidebar-border': 'oklch(0.23 0.008 155)',
    'sidebar-ring': 'oklch(0.6 0.15 150)'
  }
}

const KNOWN_KEYS = new Set([
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring'
])

export interface ThemeData {
  editorFontSize?: string
  uiFontSize?: string
  codeFontSize?: string
  editorBodyFont?: string
  editorHeadingFont?: string
  lightBackground?: string
  darkBackground?: string
  radius?: string
  light?: Record<string, string>
  dark?: Record<string, string>
}

function getThemePath(db: Database.Database): string {
  return join(getAgentBaseDir(db), THEME_FILENAME)
}

function writeThemeFile(path: string, data: ThemeData): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

/** Ensure theme.json exists in the agent base directory, creating it with defaults if missing. */
export function ensureThemeFile(db: Database.Database): void {
  const themePath = getThemePath(db)
  if (!existsSync(themePath)) {
    writeThemeFile(themePath, DEFAULT_THEME)
  }
}

function filterKnownKeys(obj: unknown): Record<string, string> | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const result: Record<string, string> = {}
  let count = 0
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (KNOWN_KEYS.has(key) && typeof value === 'string') {
      result[key] = value
      count++
    }
  }
  return count > 0 ? result : undefined
}

export function loadTheme(db: Database.Database): ThemeData {
  const themePath = getThemePath(db)
  try {
    if (!existsSync(themePath)) {
      // Recreate the file with defaults if it was deleted
      writeThemeFile(themePath, DEFAULT_THEME)
      return DEFAULT_THEME
    }
    const raw = readFileSync(themePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_THEME

    const result: ThemeData = {}
    if (typeof parsed.editorFontSize === 'string') result.editorFontSize = parsed.editorFontSize
    if (typeof parsed.uiFontSize === 'string') result.uiFontSize = parsed.uiFontSize
    if (typeof parsed.codeFontSize === 'string') result.codeFontSize = parsed.codeFontSize
    if (typeof parsed.editorBodyFont === 'string') result.editorBodyFont = parsed.editorBodyFont
    if (typeof parsed.editorHeadingFont === 'string')
      result.editorHeadingFont = parsed.editorHeadingFont
    if (typeof parsed.lightBackground === 'string') result.lightBackground = parsed.lightBackground
    if (typeof parsed.darkBackground === 'string') result.darkBackground = parsed.darkBackground
    if (typeof parsed.radius === 'string') result.radius = parsed.radius
    const light = filterKnownKeys(parsed.light)
    if (light) result.light = light
    const dark = filterKnownKeys(parsed.dark)
    if (dark) result.dark = dark

    if (Object.keys(result).length === 0) return DEFAULT_THEME
    return result
  } catch {
    return DEFAULT_THEME
  }
}

const APPEARANCE_KEYS = [
  'editorFontSize',
  'editorBodyFont',
  'editorHeadingFont',
  'lightBackground',
  'darkBackground'
] as const

/** Merge partial updates into the existing theme.json and write it back. */
export function saveTheme(db: Database.Database, partial: Partial<ThemeData>): void {
  const themePath = getThemePath(db)
  let existing: Record<string, unknown> = {}
  try {
    if (existsSync(themePath)) {
      existing = JSON.parse(readFileSync(themePath, 'utf-8'))
      if (!existing || typeof existing !== 'object') existing = {}
    }
  } catch {
    existing = {}
  }
  const merged = { ...existing, ...partial }
  mkdirSync(dirname(themePath), { recursive: true })
  writeFileSync(themePath, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
}

/** Migrate appearance settings from the DB into theme.json on first run. */
export function migrateAppearanceToTheme(db: Database.Database): void {
  const themePath = getThemePath(db)
  let themeJson: Record<string, unknown> = {}
  try {
    if (existsSync(themePath)) {
      themeJson = JSON.parse(readFileSync(themePath, 'utf-8'))
      if (!themeJson || typeof themeJson !== 'object') themeJson = {}
    }
  } catch {
    themeJson = {}
  }

  // Only migrate keys that are not already present in theme.json
  const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const updates: Record<string, string> = {}
  for (const key of APPEARANCE_KEYS) {
    if (themeJson[key] !== undefined) continue
    const row = getSettingStmt.get(key) as { value: string } | undefined
    if (row?.value) {
      updates[key] = row.value
    }
  }

  if (Object.keys(updates).length > 0) {
    saveTheme(db, updates)
  }
}

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let watchedDir: string | null = null
let storedDb: Database.Database | null = null
let storedWindow: BrowserWindow | null = null

function startWatchingDir(db: Database.Database, mainWindow: BrowserWindow): void {
  stopWatcher()

  const baseDir = getAgentBaseDir(db)
  watchedDir = baseDir
  try {
    watcher = watch(baseDir, (_eventType, filename) => {
      if (filename !== THEME_FILENAME) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          const theme = loadTheme(db)
          mainWindow.webContents.send('theme:changed', theme)
        }
      }, 200)
    })
  } catch {
    // Directory may not exist yet — silently ignore
  }
}

function stopWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    watcher.close()
    watcher = null
  }
  watchedDir = null
}

export function startThemeWatcher(db: Database.Database, mainWindow: BrowserWindow): void {
  storedDb = db
  storedWindow = mainWindow
  startWatchingDir(db, mainWindow)
}

export function restartThemeWatcher(): void {
  if (!storedDb || !storedWindow || storedWindow.isDestroyed()) return
  const newDir = getAgentBaseDir(storedDb)
  if (newDir === watchedDir) return
  // Ensure theme.json exists in the new directory
  ensureThemeFile(storedDb)
  startWatchingDir(storedDb, storedWindow)
  // Send updated theme to renderer since the directory changed
  const theme = loadTheme(storedDb)
  storedWindow.webContents.send('theme:changed', theme)
}

export function stopThemeWatcher(): void {
  stopWatcher()
  storedDb = null
  storedWindow = null
}
