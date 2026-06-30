import { existsSync } from 'fs'
import { homedir } from 'os'
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

/**
 * Writable install target for runtime `pip install`. The bundled interpreter
 * lives inside the (read-only, code-signed) app bundle, so its own
 * site-packages can't be written to at runtime. We point PYTHONUSERBASE here
 * and run pip with --user (via PIP_USER); the interpreter automatically adds
 * this base's site-packages to sys.path, so installed packages just import.
 *
 * Depends only on homedir() — no electron app state — so the sandbox module can
 * import it to grant write access without pulling in app lifecycle.
 */
export function getPythonUserBaseDir(): string {
  return join(homedir(), '.greentea', 'python')
}

/**
 * The bin/ (Scripts/ on Windows) dir under the user base, where pip --user
 * drops console scripts. Prepended to PATH so those entry points are runnable.
 */
export function getPythonUserBinDir(): string {
  const base = getPythonUserBaseDir()
  return process.platform === 'win32' ? join(base, 'Scripts') : join(base, 'bin')
}
