#!/usr/bin/env node

/**
 * Downloads a portable Python 3.12 from python-build-standalone and extracts
 * it into resources/python/. Pre-installs pip packages needed by default skills.
 *
 * Idempotent — skips if resources/python/ already exists with the expected version.
 *
 * Usage: node scripts/download-python.mjs [--force]
 */

import { execFileSync } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
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

const PIP_PACKAGES = ['pypdf', 'pdfplumber', 'openpyxl', 'python-pptx', 'pillow']

// Platform → archive name mapping
const ARCHIVE_MAP = {
  'darwin-arm64': `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-aarch64-apple-darwin-install_only_stripped.tar.gz`,
  'darwin-x64': `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-apple-darwin-install_only_stripped.tar.gz`,
  'linux-x64': `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz`,
  'win32-x64': `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`
}

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

function getPipBin() {
  if (process.platform === 'win32') {
    return join(PYTHON_DIR, 'Scripts', 'pip3.exe')
  }
  return join(PYTHON_DIR, 'bin', 'pip3')
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

    // Verify
    const pythonBin = getPythonBin()
    if (!existsSync(pythonBin)) {
      throw new Error(`Python binary not found at ${pythonBin}`)
    }

    const version = execFileSync(pythonBin, ['--version'], { encoding: 'utf-8' }).trim()
    console.log(`Extracted: ${version}`)

    // Install pip packages
    const pipBin = getPipBin()
    console.log(`Installing packages: ${PIP_PACKAGES.join(', ')}`)
    execFileSync(pipBin, ['install', '--no-cache-dir', ...PIP_PACKAGES], {
      stdio: 'inherit',
      env: { ...process.env, PYTHONHOME: PYTHON_DIR }
    })

    // Verify packages
    const importCheck = PIP_PACKAGES.map((p) =>
      p === 'python-pptx' ? 'pptx' : p === 'pillow' ? 'PIL' : p
    ).join(', ')
    execFileSync(pythonBin, ['-c', `import ${importCheck}`], {
      stdio: 'inherit',
      env: { ...process.env, PYTHONHOME: PYTHON_DIR }
    })
    console.log('All packages verified.')

    // Write version marker
    const { writeFileSync } = await import('fs')
    writeFileSync(VERSION_FILE, `${PYTHON_VERSION}+${RELEASE_TAG}\n`)

    console.log('Done! Portable Python installed to resources/python/')
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
