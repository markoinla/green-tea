import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { renderNoteToHtml } from './note-renderer'
import type { Document } from '../database/types'

// A 1x1 transparent PNG.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

describe('renderNoteToHtml', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gt-note-'))
    writeFileSync(join(dir, 'logo.png'), PNG_1x1)
    writeFileSync(
      join(dir, 'note.md'),
      ['---', 'id: abc-123', 'title: My Note', '---', '', '# Hello World', '', '![logo](./logo.png)', ''].join(
        '\n'
      )
    )
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('renders a heading and inlines the image as a data: URI', async () => {
    const doc = {
      id: 'doc-1',
      title: 'My Note',
      content: null,
      workspace_id: 'ws-1',
      folder_id: null,
      file_path: join(dir, 'note.md'),
      created_at: '',
      updated_at: '',
      frontmatter: { id: 'abc-123' },
      kind: 'note'
    } as Document

    const html = await renderNoteToHtml(doc)

    expect(html).toContain('<h1')
    expect(html).toContain('Hello World')
    expect(html).toContain('data:image/png;base64,')
    // The original relative ref must be gone (fully inlined).
    expect(html).not.toContain('./logo.png')
    // No scripts in shared output.
    expect(html).not.toContain('<script')
    expect(html).toContain('<title>My Note</title>')
  })
})
