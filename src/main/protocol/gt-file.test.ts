import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestDb } from '../database/__test__/setup'
import { createWorkspace } from '../database/repositories/workspaces'
import { addWorkspaceFile } from '../database/repositories/workspace-files'
import {
  GT_FILE_SCHEME,
  GT_FILE_PRIVILEGE,
  buildGtFileCsp,
  resolveGtFileAsset,
  createGtFileHandler
} from './gt-file'
import { PICKER_BOOTSTRAP_MARKER } from './picker-bootstrap'

let db: Database.Database
let workDir: string
let outsideDir: string
let fileId: string

beforeEach(() => {
  db = createTestDb()
  const ws = createWorkspace(db, { name: 'Test' })

  workDir = mkdtempSync(join(tmpdir(), 'gt-file-art-'))
  outsideDir = mkdtempSync(join(tmpdir(), 'gt-file-out-'))

  const entryPath = join(workDir, 'index.html')
  writeFileSync(entryPath, '<html><body>hi <script src="chart.js"></script></body></html>')
  writeFileSync(join(workDir, 'chart.js'), 'console.log(1)')
  writeFileSync(join(workDir, 'style.css'), 'body{color:red}')
  writeFileSync(join(workDir, 'icon.svg'), '<svg></svg>')
  writeFileSync(join(workDir, 'sibling.html'), '<html><body>sibling</body></html>')
  writeFileSync(join(outsideDir, 'secret.txt'), 'TOP SECRET')

  const row = addWorkspaceFile(db, {
    workspace_id: ws.id,
    file_path: entryPath,
    file_name: 'index.html'
  })
  fileId = row.id
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
  rmSync(outsideDir, { recursive: true, force: true })
})

describe('scheme registration contract', () => {
  it('uses the gt-file scheme, no bypassCSP', () => {
    expect(GT_FILE_SCHEME).toBe('gt-file')
    expect(GT_FILE_PRIVILEGE.scheme).toBe('gt-file')
    expect(GT_FILE_PRIVILEGE.privileges).toMatchObject({
      standard: true,
      secure: true,
      supportFetchAPI: true
    })
    expect('bypassCSP' in GT_FILE_PRIVILEGE.privileges).toBe(false)
  })
})

describe('buildGtFileCsp', () => {
  it('emits the v1 remote-allowed posture', () => {
    const csp = buildGtFileCsp()
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https:")
    // No `frame-ancestors`: the viewer iframe's parent is the renderer
    // (`file://`/`http://localhost`), a different origin from the served
    // `gt-file://` document, so any frame-ancestors source list (`'self'` or
    // `'none'`) would block the legitimate viewer. Safe to omit — the scheme is
    // not navigable from the open web and the iframe is sandboxed.
    expect(csp).not.toContain('frame-ancestors')
    expect(csp).not.toContain('object-src')
  })
})

describe('resolveGtFileAsset', () => {
  it('resolves a sibling asset', () => {
    const out = resolveGtFileAsset({ baseDir: workDir, requestPathname: '/chart.js' })
    expect(out).toBe(realpathSync(join(workDir, 'chart.js')))
  })

  it('rejects ../ traversal', () => {
    expect(resolveGtFileAsset({ baseDir: workDir, requestPathname: '/../secret.txt' })).toBeNull()
  })

  it('rejects percent-encoded %2e%2e traversal', () => {
    expect(
      resolveGtFileAsset({ baseDir: workDir, requestPathname: '/%2e%2e/secret.txt' })
    ).toBeNull()
  })

  it('rejects absolute request paths', () => {
    const abs = join(outsideDir, 'secret.txt')
    expect(resolveGtFileAsset({ baseDir: workDir, requestPathname: abs })).toBeNull()
  })

  it('rejects an escaping symlink', () => {
    const linkPath = join(workDir, 'escape.txt')
    symlinkSync(join(outsideDir, 'secret.txt'), linkPath)
    expect(resolveGtFileAsset({ baseDir: workDir, requestPathname: '/escape.txt' })).toBeNull()
  })

  it('rejects an empty pathname (entry handled separately)', () => {
    expect(resolveGtFileAsset({ baseDir: workDir, requestPathname: '/' })).toBeNull()
  })

  it('returns null for a missing asset', () => {
    expect(resolveGtFileAsset({ baseDir: workDir, requestPathname: '/nope.js' })).toBeNull()
  })
})

describe('createGtFileHandler', () => {
  function req(path: string): GlobalRequest {
    return new Request(`gt-file://${fileId}${path}`) as unknown as GlobalRequest
  }

  it('serves the entry file with html mime + CSP header', async () => {
    const handle = createGtFileHandler(db)
    const res = await handle(req('/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html')
    expect(res.headers.get('Content-Security-Policy')).toBe(buildGtFileCsp())
    const body = await res.text()
    expect(body).toContain('chart.js')
  })

  it('serves a sibling asset with correct mime + CSP header', async () => {
    const handle = createGtFileHandler(db)
    const res = await handle(req('/chart.js'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/javascript')
    expect(res.headers.get('Content-Security-Policy')).toBe(buildGtFileCsp())
    expect(await res.text()).toBe('console.log(1)')
  })

  it('serves css with text/css', async () => {
    const handle = createGtFileHandler(db)
    const res = await handle(req('/style.css'))
    expect(res.headers.get('Content-Type')).toBe('text/css')
  })

  it('serves svg with image/svg+xml', async () => {
    const handle = createGtFileHandler(db)
    const res = await handle(req('/icon.svg'))
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml')
  })

  it('404s on ../ traversal', async () => {
    const handle = createGtFileHandler(db)
    const res = await handle(req('/../secret.txt'))
    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Security-Policy')).toBe(buildGtFileCsp())
  })

  it('404s on unknown workspace-file id', async () => {
    const handle = createGtFileHandler(db)
    const res = await handle(new Request('gt-file://does-not-exist/') as unknown as GlobalRequest)
    expect(res.status).toBe(404)
  })

  it('404s for a missing asset', async () => {
    const handle = createGtFileHandler(db)
    const res = await handle(req('/nope.js'))
    expect(res.status).toBe(404)
  })

  it('injects the picker bootstrap into the entry html before </body>', async () => {
    const handle = createGtFileHandler(db)
    const res = await handle(req('/'))
    const body = await res.text()
    expect(body).toContain(PICKER_BOOTSTRAP_MARKER)
    const markerAt = body.indexOf(PICKER_BOOTSTRAP_MARKER)
    const closeBodyAt = body.toLowerCase().indexOf('</body>')
    expect(markerAt).toBeGreaterThanOrEqual(0)
    expect(closeBodyAt).toBeGreaterThanOrEqual(0)
    expect(markerAt).toBeLessThan(closeBodyAt)
  })

  it('keeps the CSP header on the injected entry response', async () => {
    const handle = createGtFileHandler(db)
    const res = await handle(req('/'))
    expect(res.headers.get('Content-Security-Policy')).toBe(buildGtFileCsp())
  })

  it('does NOT inject the bootstrap into a served sibling html file', async () => {
    const handle = createGtFileHandler(db)
    const res = await handle(req('/sibling.html'))
    expect(res.headers.get('Content-Type')).toBe('text/html')
    const body = await res.text()
    expect(body).not.toContain(PICKER_BOOTSTRAP_MARKER)
  })

  it('does NOT inject the bootstrap into js/css assets', async () => {
    const handle = createGtFileHandler(db)
    const js = await handle(req('/chart.js'))
    expect(await js.text()).not.toContain(PICKER_BOOTSTRAP_MARKER)
    const css = await handle(req('/style.css'))
    expect(await css.text()).not.toContain(PICKER_BOOTSTRAP_MARKER)
  })

  it('appends the bootstrap when the entry html has no </body>', async () => {
    const noBodyDir = mkdtempSync(join(tmpdir(), 'gt-file-nobody-'))
    try {
      const entryPath = join(noBodyDir, 'index.html')
      writeFileSync(entryPath, '<div>no closing body tag here</div>')
      const ws = createWorkspace(db, { name: 'NoBody' })
      const row = addWorkspaceFile(db, {
        workspace_id: ws.id,
        file_path: entryPath,
        file_name: 'index.html'
      })
      const handle = createGtFileHandler(db)
      const res = await handle(new Request(`gt-file://${row.id}/`) as unknown as GlobalRequest)
      const body = await res.text()
      expect(body).toContain(PICKER_BOOTSTRAP_MARKER)
      // Appended at the end (after the original content).
      expect(body.indexOf('no closing body tag here')).toBeLessThan(
        body.indexOf(PICKER_BOOTSTRAP_MARKER)
      )
    } finally {
      rmSync(noBodyDir, { recursive: true, force: true })
    }
  })
})
