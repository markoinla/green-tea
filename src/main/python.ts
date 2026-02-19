import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * Returns the root directory of the bundled portable Python.
 * In production: process.resourcesPath/python/
 * In dev: <project>/resources/python/
 */
export function getBundledPythonDir(): string {
  const prodPath = join(process.resourcesPath, 'python')
  if (existsSync(prodPath)) return prodPath
  return join(app.getAppPath(), 'resources', 'python')
}

/**
 * Returns the full path to the bundled python3 binary (or python.exe on Windows).
 */
export function getBundledPythonBin(): string {
  const dir = getBundledPythonDir()
  if (process.platform === 'win32') {
    return join(dir, 'python.exe')
  }
  return join(dir, 'bin', 'python3')
}

/**
 * Returns the bin/ (or Scripts/ on Windows) directory for PATH prepending.
 */
export function getPythonBinDir(): string | null {
  const dir = getBundledPythonDir()
  const binDir = process.platform === 'win32' ? join(dir, 'Scripts') : join(dir, 'bin')
  if (existsSync(binDir)) return binDir
  return null
}

/**
 * Returns true if the bundled Python binary exists on disk.
 */
export function isPythonBundled(): boolean {
  return existsSync(getBundledPythonBin())
}
