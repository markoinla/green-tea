import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The registry client reads the account bearer from the encrypted secrets store
// (safeStorage) and the install path goes through plugins/skills managers
// (electron `app`). Mock electron the same way manager.test.ts / account.test.ts do.
vi.mock('electron', () => ({
  app: {
    getVersion: () => '6.2.1',
    getAppPath: () => process.cwd()
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'kwallet',
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8')
      if (!s.startsWith('enc:')) throw new Error('cannot decrypt')
      return s.slice(4)
    }
  },
  shell: { openExternal: vi.fn() }
}))

import type Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestDb } from '../database/__test__/setup'
import { setSetting } from '../database/repositories/settings'
import { setSecret } from '../secrets'
import { getPluginsDir } from '../plugins/manager'
import { getSkillsDir } from '../skills/manager'
import {
  searchRegistry,
  getRegistryItem,
  getRegistryVersionManifest,
  publishToRegistry,
  reportRegistryItem,
  claimHandle,
  checkRegistryUpdates,
  installFromRegistry,
  listRegistryInstalls
} from './client'
import { readRegistryProvenance, validateRegistryFilePath } from './install-files'
import type { RegistryItemDetailResponse } from '../../shared/share-contract'

const BASE = 'https://share.test'
const ACCOUNT_TOKEN_KEY = 'account:token'

let db: Database.Database
let baseDir: string

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

function bytesResponse(text: string): Response {
  const bytes = new TextEncoder().encode(text)
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(0)
  } as unknown as Response
}

function headersOf(call: [unknown, RequestInit?]): Record<string, string> {
  return ((call[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>
}

beforeEach(() => {
  db = createTestDb()
  baseDir = mkdtempSync(join(tmpdir(), 'gt-registry-'))
  setSetting(db, 'agentBaseDir', baseDir)
  process.env.SHARE_BASE_URL = BASE
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
  db.close()
  delete process.env.SHARE_BASE_URL
  vi.restoreAllMocks()
})

describe('searchRegistry', () => {
  it('builds the query string and sends no auth header when signed out', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ items: [] }))

    await searchRegistry(db, { q: 'pdf', sort: 'installs', type: 'plugin' })

    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      `${BASE}/registry/items?q=pdf&sort=installs&type=plugin`
    )
    expect(headersOf(fetchSpy.mock.calls[0]).Authorization).toBeUndefined()
  })

  it('attaches the account bearer when signed in', async () => {
    setSecret(db, ACCOUNT_TOKEN_KEY, 'acct_tok_123')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ items: [] }))

    await searchRegistry(db)

    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${BASE}/registry/items`)
    expect(headersOf(fetchSpy.mock.calls[0]).Authorization).toBe('Bearer acct_tok_123')
  })

  it('surfaces the worker JSON error message on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'rate limited' }, false, 429)
    )
    await expect(searchRegistry(db)).rejects.toThrow(/429.*rate limited/)
  })
})

describe('getRegistryItem', () => {
  it('addresses the item as two explicit path segments', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ item: {}, versions: [] }))
    await getRegistryItem(db, 'alice/pdf-tools')
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${BASE}/registry/items/alice/pdf-tools`)
  })

  it('flattens the wrapped { item, versions } response and fills in the slug', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        item: {
          id: 'alice/pdf-tools',
          type: 'plugin',
          name: 'PDF Tools',
          description: 'd',
          handle: 'alice',
          latestVersion: '1.2.0',
          installCount: 3,
          updatedAt: 10,
          status: 'published',
          createdAt: 5
        },
        versions: [{ version: '1.2.0', sizeBytes: 42, createdAt: 10 }]
      })
    )

    const item = await getRegistryItem(db, 'alice/pdf-tools')

    expect(item.latestVersion).toBe('1.2.0')
    expect(item.type).toBe('plugin')
    expect(item.slug).toBe('pdf-tools')
    expect(item.versions).toEqual([{ version: '1.2.0', sizeBytes: 42, createdAt: 10 }])
  })

  it('rejects malformed item ids without any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(getRegistryItem(db, 'no-slash')).rejects.toThrow(/item id/i)
    await expect(getRegistryItem(db, 'a/b/c')).rejects.toThrow(/item id/i)
    await expect(getRegistryItem(db, '../etc/passwd')).rejects.toThrow()
    await expect(getRegistryItem(db, 'UPPER/slug')).rejects.toThrow(/handle/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('publishToRegistry', () => {
  const goodRequest = {
    type: 'plugin' as const,
    slug: 'pdf-tools',
    version: '1.2.0',
    manifest: { id: 'pdf-tools', name: 'PDF Tools', version: '1.2.0', description: 'd' },
    files: [{ path: 'viewer.html', contentBase64: 'aGk=' }]
  }

  it('requires sign-in (throws before any fetch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(publishToRegistry(db, goodRequest)).rejects.toThrow(/sign in/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs the request JSON with the account bearer', async () => {
    setSecret(db, ACCOUNT_TOKEN_KEY, 'acct_tok_123')
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ id: 'alice/pdf-tools', version: '1.2.0' }))

    const out = await publishToRegistry(db, goodRequest)

    expect(out).toEqual({ id: 'alice/pdf-tools', version: '1.2.0' })
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe(`${BASE}/registry/publish`)
    expect(init?.method).toBe('POST')
    expect(headersOf([url, init]).Authorization).toBe('Bearer acct_tok_123')
    expect(headersOf([url, init])['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual(goodRequest)
  })

  it('rejects loose or prerelease versions client-side', async () => {
    setSecret(db, ACCOUNT_TOKEN_KEY, 't')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    for (const version of ['v1.0.0', '01.0.0', '1.0', '1.0.0-beta', '1.0.0+build']) {
      await expect(publishToRegistry(db, { ...goodRequest, version })).rejects.toThrow(/version/i)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an invalid slug, a reserved handle, and a traversal file path', async () => {
    setSecret(db, ACCOUNT_TOKEN_KEY, 't')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(publishToRegistry(db, { ...goodRequest, slug: 'Bad_Slug' })).rejects.toThrow(
      /slug/i
    )
    await expect(publishToRegistry(db, { ...goodRequest, handle: 'greentea' })).rejects.toThrow(
      /reserved/i
    )
    await expect(
      publishToRegistry(db, {
        ...goodRequest,
        files: [{ path: '../evil.sh', contentBase64: 'aGk=' }]
      })
    ).rejects.toThrow(/\.\./)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('reportRegistryItem', () => {
  it('POSTs the trimmed reason to the report route with the bearer', async () => {
    setSecret(db, ACCOUNT_TOKEN_KEY, 'acct_tok_123')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }))

    await reportRegistryItem(db, 'alice/pdf-tools', '  malware  ')

    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe(`${BASE}/registry/items/alice/pdf-tools/report`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'malware' })
    expect(headersOf([url, init]).Authorization).toBe('Bearer acct_tok_123')
  })

  it('rejects an empty or over-long reason without a network call', async () => {
    setSecret(db, ACCOUNT_TOKEN_KEY, 't')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(reportRegistryItem(db, 'alice/pdf-tools', '   ')).rejects.toThrow(/required/i)
    await expect(reportRegistryItem(db, 'alice/pdf-tools', 'x'.repeat(2001))).rejects.toThrow(
      /too long/i
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('claimHandle', () => {
  it('accepts a well-formed handle', () => {
    expect(claimHandle('marko-dev')).toEqual({ ok: true })
  })

  it('rejects reserved and malformed handles', () => {
    expect(claimHandle('greentea').ok).toBe(false)
    expect(claimHandle('official').ok).toBe(false)
    expect(claimHandle('UPPER').ok).toBe(false)
    expect(claimHandle('-leading').ok).toBe(false)
    expect(claimHandle('trailing-').ok).toBe(false)
    expect(claimHandle('a'.repeat(40)).ok).toBe(false)
    expect(claimHandle('').ok).toBe(false)
  })
})

describe('checkRegistryUpdates', () => {
  it('batches ids into one request and compares semver numerically', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        items: [
          { id: 'alice/pdf-tools', latestVersion: '1.10.0' },
          { id: 'bob/notes-skill', latestVersion: '2.0.0' }
        ]
      })
    )

    const updates = await checkRegistryUpdates(db, [
      { itemId: 'alice/pdf-tools', version: '1.9.0' },
      { itemId: 'bob/notes-skill', version: '2.0.0' }
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchSpy.mock.calls[0][0]))
    expect(url.pathname).toBe('/registry/items')
    expect(url.searchParams.get('ids')).toBe('alice/pdf-tools,bob/notes-skill')
    // 1.10.0 > 1.9.0 numerically (a lexicographic compare would miss this).
    expect(updates).toEqual([
      { itemId: 'alice/pdf-tools', installedVersion: '1.9.0', latestVersion: '1.10.0' }
    ])
  })

  it('skips malformed refs and items the server no longer returns', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ items: [] }))

    const updates = await checkRegistryUpdates(db, [
      { itemId: 'not-an-id', version: '1.0.0' },
      { itemId: 'alice/gone', version: '1.0.0' }
    ])

    expect(updates).toEqual([])
    const url = new URL(String(fetchSpy.mock.calls[0][0]))
    expect(url.searchParams.get('ids')).toBe('alice/gone')
  })

  it('makes no network call when nothing valid is installed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await checkRegistryUpdates(db, [])).toEqual([])
    expect(await checkRegistryUpdates(db, [{ itemId: 'bad', version: 'x' }])).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('chunks past the worker 100-id cap and merges results across requests', async () => {
    // Echo server: every requested id comes back at latest 2.0.0, so an update
    // is reported for a ref if AND ONLY IF its chunk was actually requested.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const ids = new URL(String(input)).searchParams.get('ids')!.split(',')
      return jsonResponse({ items: ids.map((id) => ({ id, latestVersion: '2.0.0' })) })
    })

    const installed = Array.from({ length: 150 }, (_, i) => ({
      itemId: `user${i}/pkg-${i}`,
      version: '1.0.0'
    }))
    const updates = await checkRegistryUpdates(db, installed)

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const idsOf = (call: number): string[] =>
      new URL(String(fetchSpy.mock.calls[call][0])).searchParams.get('ids')!.split(',')
    expect(idsOf(0)).toHaveLength(100)
    expect(idsOf(1)).toHaveLength(50)
    expect(idsOf(0)[0]).toBe('user0/pkg-0')
    expect(idsOf(1)[0]).toBe('user100/pkg-100')
    // Every installed ref got an update — including all of the second chunk.
    expect(updates).toHaveLength(150)
    expect(updates[149]).toEqual({
      itemId: 'user149/pkg-149',
      installedVersion: '1.0.0',
      latestVersion: '2.0.0'
    })
  })
})

// --- installFromRegistry ------------------------------------------------------

// Wire shape: the worker's wrapped detail response (no slug inside item).
const pluginDetail: RegistryItemDetailResponse = {
  item: {
    id: 'alice/pdf-tools',
    type: 'plugin',
    name: 'PDF Tools',
    description: 'd',
    handle: 'alice',
    latestVersion: '1.0.0',
    installCount: 0,
    updatedAt: 0,
    status: 'published',
    createdAt: 0
  },
  versions: [{ version: '1.0.0', sizeBytes: 42, createdAt: 0 }]
}

const pluginManifest = {
  id: 'pdf-tools',
  name: 'PDF Tools',
  version: '1.0.0',
  description: 'd'
}

/** Route a fetch mock across detail / files-list / file-bytes registry endpoints. */
function stubRegistryFetch(options: {
  detail: RegistryItemDetailResponse
  manifest: Record<string, unknown>
  files: { path: string; sizeBytes: number }[]
  fileContent?: (path: string) => string
}): ReturnType<typeof vi.spyOn> {
  const route = `/registry/items/${options.detail.item.id}`
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const filePrefix = `${BASE}${route}/versions/${options.detail.item.latestVersion}/file/`
    if (url === `${BASE}${route}`) return jsonResponse(options.detail)
    if (url === `${BASE}${route}/versions/${options.detail.item.latestVersion}/files`) {
      return jsonResponse({ manifest: options.manifest, files: options.files })
    }
    if (url.startsWith(filePrefix)) {
      const path = decodeURIComponent(url.slice(filePrefix.length))
      return bytesResponse(options.fileContent?.(path) ?? `content:${path}`)
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

describe('getRegistryVersionManifest', () => {
  it('never sends the bearer on the files fetch (a consent peek must not count as an install)', async () => {
    setSecret(db, ACCOUNT_TOKEN_KEY, 'acct_tok_123')
    const fetchSpy = stubRegistryFetch({
      detail: pluginDetail,
      manifest: pluginManifest,
      files: [{ path: 'viewer.html', sizeBytes: 1 }]
    })

    const out = await getRegistryVersionManifest(db, 'alice/pdf-tools')

    expect(out).toEqual({ version: '1.0.0', manifest: pluginManifest })
    const filesCall = fetchSpy.mock.calls.find((c) => String(c[0]).endsWith('/files'))
    expect(filesCall).toBeDefined()
    expect(headersOf(filesCall as [unknown, RequestInit?]).Authorization).toBeUndefined()
  })
})

describe('installFromRegistry (plugin write path)', () => {
  it('writes files under <handle>--<slug>, rewrites the manifest id, and records provenance', async () => {
    stubRegistryFetch({
      detail: pluginDetail,
      manifest: pluginManifest,
      files: [
        { path: 'viewer.html', sizeBytes: 1 },
        { path: 'assets/style.css', sizeBytes: 1 }
      ]
    })

    const result = await installFromRegistry(db, 'alice/pdf-tools')

    expect(result.type).toBe('plugin')
    if (result.type !== 'plugin') return
    const dir = join(getPluginsDir(db), 'alice--pdf-tools')
    expect(result.plugin.id).toBe('alice--pdf-tools')
    expect(result.plugin.dir).toBe(dir)
    expect(result.plugin.enabled).toBe(true)
    expect(readFileSync(join(dir, 'viewer.html'), 'utf-8')).toBe('content:viewer.html')
    expect(readFileSync(join(dir, 'assets', 'style.css'), 'utf-8')).toBe('content:assets/style.css')
    // Server-validated manifest is written by the client, id rewritten to the dir name.
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'))
    expect(manifest.id).toBe('alice--pdf-tools')
    expect(manifest.name).toBe('PDF Tools')
    // Provenance marker is the record for update checks / consent / publish gating.
    expect(readRegistryProvenance(dir)).toMatchObject({
      itemId: 'alice/pdf-tools',
      type: 'plugin',
      version: '1.0.0'
    })
    expect(listRegistryInstalls(db)).toEqual([
      { itemId: 'alice/pdf-tools', type: 'plugin', version: '1.0.0' }
    ])
  })

  it('rejects a traversal path from the server before downloading any bytes', async () => {
    const fetchSpy = stubRegistryFetch({
      detail: pluginDetail,
      manifest: pluginManifest,
      files: [
        { path: 'ok.txt', sizeBytes: 1 },
        { path: 'a/../../../../evil.txt', sizeBytes: 1 }
      ]
    })

    await expect(installFromRegistry(db, 'alice/pdf-tools')).rejects.toThrow(/\.\./)

    // Validation runs over the whole list before any /file/ download.
    const fileFetches = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/file/'))
    expect(fileFetches).toHaveLength(0)
    expect(existsSync(join(getPluginsDir(db), 'alice--pdf-tools'))).toBe(false)
  })

  it('rejects absolute, drive-letter, backslash and dot-segment paths', () => {
    for (const path of ['/etc/passwd', 'C:evil', 'a\\b', 'a//b', './a', 'a/./b', '..']) {
      expect(() => validateRegistryFilePath(path)).toThrow()
    }
    expect(validateRegistryFilePath('scripts/run.py')).toBe('scripts/run.py')
  })

  it('cleans up the install dir when manifest validation fails', async () => {
    stubRegistryFetch({
      detail: pluginDetail,
      // Missing "name" — loadManifest throws after files are written.
      manifest: { id: 'pdf-tools', version: '1.0.0', description: 'd' },
      files: [{ path: 'viewer.html', sizeBytes: 1 }]
    })

    await expect(installFromRegistry(db, 'alice/pdf-tools')).rejects.toThrow(/name/i)
    expect(existsSync(join(getPluginsDir(db), 'alice--pdf-tools'))).toBe(false)
  })

  it('rejects a bundle that smuggles its own manifest.json and cleans up', async () => {
    stubRegistryFetch({
      detail: pluginDetail,
      manifest: pluginManifest,
      files: [
        { path: 'manifest.json', sizeBytes: 1 },
        { path: 'viewer.html', sizeBytes: 1 }
      ]
    })

    await expect(installFromRegistry(db, 'alice/pdf-tools')).rejects.toThrow(/manifest\.json/)
    expect(existsSync(join(getPluginsDir(db), 'alice--pdf-tools'))).toBe(false)
  })
})

describe('installFromRegistry (skill write path)', () => {
  const skillDetail: RegistryItemDetailResponse = {
    item: {
      ...pluginDetail.item,
      id: 'alice/daily-review',
      type: 'skill',
      name: 'Daily Review'
    },
    versions: pluginDetail.versions
  }

  const skillMd = [
    '---',
    'name: daily-review',
    'description: Reviews your day',
    '---',
    '',
    '# Daily Review'
  ].join('\n')

  it('installs a valid skill without adaptation and records provenance', async () => {
    stubRegistryFetch({
      detail: skillDetail,
      manifest: {},
      files: [{ path: 'SKILL.md', sizeBytes: 1 }],
      fileContent: () => skillMd
    })

    const result = await installFromRegistry(db, 'alice/daily-review')

    expect(result.type).toBe('skill')
    if (result.type !== 'skill') return
    expect(result.skill.name).toBe('daily-review')
    expect(result.skill.description).toBe('Reviews your day')
    const dir = join(getSkillsDir(db), 'alice--daily-review')
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf-8')).toBe(skillMd)
    expect(readRegistryProvenance(dir)).toMatchObject({
      itemId: 'alice/daily-review',
      type: 'skill',
      version: '1.0.0'
    })
    expect(listRegistryInstalls(db)).toEqual([
      { itemId: 'alice/daily-review', type: 'skill', version: '1.0.0' }
    ])
  })

  it('refuses to install when another skill already loads under the same name', async () => {
    stubRegistryFetch({
      detail: skillDetail,
      manifest: {},
      files: [{ path: 'SKILL.md', sizeBytes: 1 }],
      fileContent: () => skillMd
    })
    await installFromRegistry(db, 'alice/daily-review')
    vi.restoreAllMocks()

    // bob publishes his own daily-review: same slug, same frontmatter name
    // (publish pins name === slug) — a different registry item that would
    // collide as a loaded skill.
    stubRegistryFetch({
      detail: { ...skillDetail, item: { ...skillDetail.item, id: 'bob/daily-review' } },
      manifest: {},
      files: [{ path: 'SKILL.md', sizeBytes: 1 }],
      fileContent: () => skillMd
    })

    await expect(installFromRegistry(db, 'bob/daily-review')).rejects.toThrow(
      /named "daily-review" is already installed/i
    )
    // alice's install is untouched, bob's never hit disk.
    expect(existsSync(join(getSkillsDir(db), 'alice--daily-review'))).toBe(true)
    expect(existsSync(join(getSkillsDir(db), 'bob--daily-review'))).toBe(false)
  })

  it('still allows re-installing (updating) the SAME registry item', async () => {
    stubRegistryFetch({
      detail: skillDetail,
      manifest: {},
      files: [{ path: 'SKILL.md', sizeBytes: 1 }],
      fileContent: () => skillMd
    })
    await installFromRegistry(db, 'alice/daily-review')
    const again = await installFromRegistry(db, 'alice/daily-review')
    expect(again.type).toBe('skill')
  })

  it('refuses when a non-registry user skill already uses the name', async () => {
    // A hand-installed (GitHub/marketplace) skill occupying the flat name.
    const localDir = join(getSkillsDir(db), 'daily-review')
    mkdirSync(localDir, { recursive: true })
    writeFileSync(join(localDir, 'SKILL.md'), skillMd)

    stubRegistryFetch({
      detail: skillDetail,
      manifest: {},
      files: [{ path: 'SKILL.md', sizeBytes: 1 }],
      fileContent: () => skillMd
    })

    await expect(installFromRegistry(db, 'alice/daily-review')).rejects.toThrow(
      /named "daily-review" is already installed/i
    )
    expect(existsSync(join(getSkillsDir(db), 'alice--daily-review'))).toBe(false)
  })

  it('cleans up when the downloaded skill cannot be loaded (no description)', async () => {
    stubRegistryFetch({
      detail: skillDetail,
      manifest: {},
      files: [{ path: 'SKILL.md', sizeBytes: 1 }],
      // Missing description — the loader hard-fails on that, so install must roll back.
      fileContent: () => ['---', 'name: daily-review', '---', '', 'body'].join('\n')
    })

    await expect(installFromRegistry(db, 'alice/daily-review')).rejects.toThrow(
      /could not be loaded/i
    )
    expect(existsSync(join(getSkillsDir(db), 'alice--daily-review'))).toBe(false)
  })
})

describe('listRegistryInstalls (provenance type)', () => {
  function writeMarker(dir: string, marker: Record<string, unknown>): void {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.registry.json'), JSON.stringify(marker))
  }

  it('infers the type of legacy markers (no type field) from the containing dir', () => {
    writeMarker(join(getPluginsDir(db), 'alice--pdf-tools'), {
      itemId: 'alice/pdf-tools',
      version: '1.0.0',
      installedAt: 'x'
    })
    writeMarker(join(getSkillsDir(db), 'bob--daily-review'), {
      itemId: 'bob/daily-review',
      version: '2.0.0',
      installedAt: 'x'
    })

    expect(listRegistryInstalls(db)).toEqual([
      { itemId: 'alice/pdf-tools', type: 'plugin', version: '1.0.0' },
      { itemId: 'bob/daily-review', type: 'skill', version: '2.0.0' }
    ])
  })

  it('treats an unrecognized marker type as legacy (dir wins) instead of rejecting', () => {
    const dir = join(getSkillsDir(db), 'bob--daily-review')
    writeMarker(dir, {
      itemId: 'bob/daily-review',
      type: 'wasm-module',
      version: '2.0.0',
      installedAt: 'x'
    })

    expect(readRegistryProvenance(dir)?.type).toBeUndefined()
    expect(listRegistryInstalls(db)).toEqual([
      { itemId: 'bob/daily-review', type: 'skill', version: '2.0.0' }
    ])
  })
})
