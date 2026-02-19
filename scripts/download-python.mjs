#!/usr/bin/env node

/**
 * Downloads a portable Python 3.12 from python-build-standalone, extracts it
 * into resources/python/, and trims unnecessary files to minimize bundle size.
 *
 * Only Python + pip are bundled — the agent installs packages as needed at runtime.
 *
 * Idempotent — skips if resources/python/ already exists with the expected version.
 *
 * Usage: node scripts/download-python.mjs [--force]
 */

import { execFileSync } from 'child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { pipeline } from 'stream/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PYTHON_DIR = join(ROOT, 'resources', 'python')
const VERSION_FILE = join(PYTHON_DIR, '.python-version')

const PYTHON_VERSION = '3.12.12'
const RELEASE_TAG = '20260211'
const FORCE = process.argv.includes('--force')

// Platform → archive name mapping
const ARCHIVE_MAP = {
  'darwin-arm64': `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-aarch64-apple-darwin-install_only_stripped.tar.gz`,
  'darwin-x64': `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-apple-darwin-install_only_stripped.tar.gz`,
  'linux-x64': `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz`,
  'win32-x64': `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`
}

// Stdlib directories safe to remove (not needed for pip or general scripting)
const STDLIB_REMOVE = [
  'idlelib',
  'tkinter',
  'turtledemo',
  'turtle.py',
  'lib2to3',
  'ensurepip',
  'unittest',
  'test',
  'pydoc_data',
  'pydoc.py'
]

// Platform-specific stdlib config dirs to remove
const STDLIB_CONFIG_REMOVE_PATTERNS = ['config-3.12-']

// Top-level directories/files safe to remove
const TOP_LEVEL_REMOVE = ['include', 'share']

// Lib-level files safe to remove (tcl/tk GUI libraries — macOS/Linux)
const LIB_REMOVE = ['tcl9.0', 'tk9.0', 'tcl9', 'itcl4.3.5', 'thread3.0.4']

// Lib-level prefix patterns for tcl/tk dylibs (macOS/Linux)
const LIB_DYLIB_REMOVE = ['libtcl', 'libtk', 'libtcl9tk']

// Windows top-level dirs safe to remove
const WIN_TOP_LEVEL_REMOVE = ['include', 'tcl']

// Windows DLLs to remove (tk/tcl related)
const WIN_DLL_REMOVE_PATTERNS = ['tcl', 'tk', '_tkinter']

function getArchiveFilename() {
  const key = `${process.platform}-${process.arch}`
  const filename = ARCHIVE_MAP[key]
  if (!filename) {
    console.error(`Unsupported platform: ${key}`)
    console.error(`Supported: ${Object.keys(ARCHIVE_MAP).join(', ')}`)
    process.exit(1)
  }
  return filename
}

function isAlreadyInstalled() {
  if (!existsSync(VERSION_FILE)) return false
  const installed = readFileSync(VERSION_FILE, 'utf-8').trim()
  return installed === `${PYTHON_VERSION}+${RELEASE_TAG}`
}

async function downloadFile(url, dest) {
  console.log(`Downloading ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  await pipeline(res.body, createWriteStream(dest))
}

function getPythonBin() {
  if (process.platform === 'win32') {
    return join(PYTHON_DIR, 'python.exe')
  }
  return join(PYTHON_DIR, 'bin', 'python3')
}

function dirSize(dir) {
  let size = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      size += dirSize(fullPath)
    } else {
      size += statSync(fullPath).size
    }
  }
  return size
}

function removePycacheRecursive(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') {
        rmSync(fullPath, { recursive: true, force: true })
      } else {
        removePycacheRecursive(fullPath)
      }
    }
  }
}

function trimBundle() {
  console.log('Trimming bundle...')
  let saved = 0

  const safeRemove = (path, label) => {
    if (existsSync(path)) {
      const size = statSync(path).isDirectory() ? dirSize(path) : statSync(path).size
      rmSync(path, { recursive: true, force: true })
      saved += size
      console.log(`  Removed ${label} (${(size / 1024 / 1024).toFixed(1)}MB)`)
    }
  }

  const isWindows = process.platform === 'win32'

  if (isWindows) {
    // Windows layout: python.exe at root, Lib/ for stdlib, DLLs/, Scripts/, tcl/
    for (const name of WIN_TOP_LEVEL_REMOVE) {
      safeRemove(join(PYTHON_DIR, name), name)
    }

    // Remove tk/tcl DLLs
    const dllsDir = join(PYTHON_DIR, 'DLLs')
    if (existsSync(dllsDir)) {
      for (const entry of readdirSync(dllsDir)) {
        const lower = entry.toLowerCase()
        if (WIN_DLL_REMOVE_PATTERNS.some((p) => lower.startsWith(p))) {
          safeRemove(join(dllsDir, entry), `DLLs/${entry}`)
        }
      }
    }

    // Stdlib is in Lib/ on Windows
    const stdlibDir = join(PYTHON_DIR, 'Lib')
    if (existsSync(stdlibDir)) {
      for (const name of STDLIB_REMOVE) {
        safeRemove(join(stdlibDir, name), `Lib/${name}`)
      }
    }
  } else {
    // macOS/Linux layout: bin/, lib/python3.12/, lib/libpython3.12.dylib, etc.
    for (const name of TOP_LEVEL_REMOVE) {
      safeRemove(join(PYTHON_DIR, name), name)
    }

    // Remove tcl/tk libs
    const libDir = join(PYTHON_DIR, 'lib')
    if (existsSync(libDir)) {
      for (const name of LIB_REMOVE) {
        safeRemove(join(libDir, name), `lib/${name}`)
      }
      // Remove tcl/tk dylibs
      for (const entry of readdirSync(libDir)) {
        if (LIB_DYLIB_REMOVE.some((prefix) => entry.startsWith(prefix))) {
          safeRemove(join(libDir, entry), `lib/${entry}`)
        }
      }
    }

    // Stdlib is in lib/python3.12/ on macOS/Linux
    const stdlibDir = join(PYTHON_DIR, 'lib', 'python3.12')
    if (existsSync(stdlibDir)) {
      for (const name of STDLIB_REMOVE) {
        safeRemove(join(stdlibDir, name), `stdlib/${name}`)
      }
      // Remove config-3.12-* dirs
      for (const entry of readdirSync(stdlibDir)) {
        if (STDLIB_CONFIG_REMOVE_PATTERNS.some((p) => entry.startsWith(p))) {
          safeRemove(join(stdlibDir, entry), `stdlib/${entry}`)
        }
      }
    }
  }

  // Remove __pycache__ dirs everywhere (both platforms)
  const pycacheBefore = dirSize(PYTHON_DIR)
  removePycacheRecursive(PYTHON_DIR)
  const pycacheSaved = pycacheBefore - dirSize(PYTHON_DIR)
  if (pycacheSaved > 0) {
    saved += pycacheSaved
    console.log(`  Removed __pycache__ dirs (${(pycacheSaved / 1024 / 1024).toFixed(1)}MB)`)
  }

  console.log(`  Total saved: ${(saved / 1024 / 1024).toFixed(0)}MB`)
}

async function main() {
  if (!FORCE && isAlreadyInstalled()) {
    console.log(`Python ${PYTHON_VERSION}+${RELEASE_TAG} already installed in resources/python/`)
    return
  }

  const archiveFilename = getArchiveFilename()
  const downloadUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}/${archiveFilename}`

  // Clean up any previous install
  if (existsSync(PYTHON_DIR)) {
    console.log('Removing existing resources/python/ ...')
    rmSync(PYTHON_DIR, { recursive: true, force: true })
  }

  mkdirSync(join(ROOT, 'resources'), { recursive: true })

  const archivePath = join(ROOT, 'resources', archiveFilename)

  try {
    // Download
    await downloadFile(downloadUrl, archivePath)

    // Extract — tar.gz always extracts to a `python/` directory
    console.log('Extracting...')
    mkdirSync(PYTHON_DIR, { recursive: true })
    execFileSync('tar', ['xzf', archivePath, '--strip-components=1', '-C', PYTHON_DIR], {
      stdio: 'inherit'
    })

    // Verify python works
    const pythonBin = getPythonBin()
    if (!existsSync(pythonBin)) {
      throw new Error(`Python binary not found at ${pythonBin}`)
    }

    const version = execFileSync(pythonBin, ['--version'], { encoding: 'utf-8' }).trim()
    console.log(`Extracted: ${version}`)

    // Verify pip works
    execFileSync(pythonBin, ['-m', 'pip', '--version'], {
      stdio: 'inherit',
      env: { ...process.env, PYTHONHOME: PYTHON_DIR }
    })

    // Trim unnecessary files
    trimBundle()

    // Verify python + pip still work after trimming
    const verifyVersion = execFileSync(pythonBin, ['--version'], { encoding: 'utf-8' }).trim()
    execFileSync(pythonBin, ['-m', 'pip', '--version'], {
      stdio: 'pipe',
      env: { ...process.env, PYTHONHOME: PYTHON_DIR }
    })
    console.log(`Verified after trim: ${verifyVersion}, pip OK`)

    // Write version marker
    writeFileSync(VERSION_FILE, `${PYTHON_VERSION}+${RELEASE_TAG}\n`)

    const finalSize = (dirSize(PYTHON_DIR) / 1024 / 1024).toFixed(0)
    console.log(`Done! Portable Python installed to resources/python/ (${finalSize}MB)`)
  } finally {
    // Clean up archive
    if (existsSync(archivePath)) {
      rmSync(archivePath)
    }
  }
}

main().catch((err) => {
  console.error('Failed to download Python:', err.message)
  process.exit(1)
})
