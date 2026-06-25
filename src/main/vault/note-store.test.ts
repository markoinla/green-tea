import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  readNote,
  writeNote,
  listVaultNotes,
  backfillFrontmatter,
  slugifyTitle,
  uniqueNotePath,
  titleFromFilename
} from './note-store'
import { markdownToTiptap } from '../markdown/tiptap-markdown'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gt-vault-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('title <-> filename', () => {
  it('derives title from filename', () => {
    expect(titleFromFilename(join(dir, 'My Note.md'))).toBe('My Note')
  })

  it('slugifies filesystem-hostile titles', () => {
    expect(slugifyTitle('Q3: Plan / Draft?')).toBe('Q3 Plan Draft')
    expect(slugifyTitle('   ')).toBe('Untitled')
  })

  it('picks a unique filename on collision', () => {
    writeFileSync(join(dir, 'Note.md'), 'x')
    expect(uniqueNotePath(dir, 'Note')).toBe(join(dir, 'Note 2.md'))
    writeFileSync(join(dir, 'Note 2.md'), 'x')
    expect(uniqueNotePath(dir, 'Note')).toBe(join(dir, 'Note 3.md'))
  })
})

describe('frontmatter backfill', () => {
  it('stamps id/created/updated when missing', () => {
    const { frontmatter, changed } = backfillFrontmatter({}, '2026-06-24T10:00:00.000Z')
    expect(changed).toBe(true)
    expect(typeof frontmatter.id).toBe('string')
    expect(frontmatter.created).toBe('2026-06-24T10:00:00.000Z')
    expect(frontmatter.updated).toBe('2026-06-24T10:00:00.000Z')
  })

  it('leaves existing identity untouched', () => {
    const input = {
      id: 'keep-me',
      created: '2020-01-01T00:00:00.000Z',
      updated: '2020-01-02T00:00:00.000Z'
    }
    const { frontmatter, changed } = backfillFrontmatter(input, '2026-06-24T10:00:00.000Z')
    expect(changed).toBe(false)
    expect(frontmatter.id).toBe('keep-me')
    expect(frontmatter.created).toBe('2020-01-01T00:00:00.000Z')
  })
})

describe('read / write round-trip', () => {
  it('writes atomically and reads back an equal document', () => {
    const doc = markdownToTiptap('# Hello\n\nWorld **bold**')
    const file = join(dir, 'Hello.md')
    writeNote(file, {
      frontmatter: {
        id: 'abc',
        created: '2026-06-24T10:00:00.000Z',
        updated: '2026-06-24T10:00:00.000Z'
      },
      doc
    })

    expect(existsSync(file)).toBe(true)
    const note = readNote(file)
    expect(note.id).toBe('abc')
    expect(note.title).toBe('Hello')
    expect(note.doc).toEqual(doc)
  })

  it('leaves no temp files behind after an atomic write', () => {
    const doc = markdownToTiptap('text')
    writeNote(join(dir, 'A.md'), { frontmatter: { id: 'a' }, doc })
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'))
    expect(leftovers).toEqual([])
  })

  it('backfills and persists identity for a foreign file on first read', () => {
    const file = join(dir, 'Foreign.md')
    writeFileSync(file, '# Foreign note\n\nNo frontmatter here.\n')
    const note = readNote(file)
    expect(typeof note.id).toBe('string')
    expect(note.id.length).toBeGreaterThan(0)
    // The id was written back to disk.
    const onDisk = readFileSync(file, 'utf-8')
    expect(onDisk).toContain(`id: ${note.id}`)
    // Title comes from the filename, not the H1.
    expect(note.title).toBe('Foreign')
  })

  it('uses frontmatter.title as an override when present', () => {
    const file = join(dir, 'slug-name.md')
    writeFileSync(file, '---\nid: x\ntitle: "Fancy: Title"\n---\n\nbody\n')
    expect(readNote(file).title).toBe('Fancy: Title')
  })
})

describe('vault listing', () => {
  it('lists nested notes and ignores non-note files and ignored dirs', () => {
    mkdirSync(join(dir, 'Projects'))
    mkdirSync(join(dir, 'attachments'))
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, 'Inbox.md'), '---\nid: 1\n---\n\nhi\n')
    writeFileSync(join(dir, 'Projects', 'Plan.md'), '---\nid: 2\n---\n\nplan\n')
    writeFileSync(join(dir, 'attachments', 'diagram.png'), 'binary')
    writeFileSync(join(dir, 'attachments', 'notes.md'), '---\nid: 3\n---\n\nshould be ignored\n')
    writeFileSync(join(dir, '.git', 'config.md'), 'ignored')
    writeFileSync(join(dir, 'readme.txt'), 'not a note')

    const notes = listVaultNotes(dir)
    const paths = notes.map((n) => n.folder + '/' + n.title).sort()
    expect(paths).toEqual(['/Inbox', 'Projects/Plan'])
  })

  it('returns folder paths relative to the vault root', () => {
    mkdirSync(join(dir, 'A', 'B'), { recursive: true })
    writeFileSync(join(dir, 'A', 'B', 'Deep.md'), '---\nid: d\n---\n\nx\n')
    const note = listVaultNotes(dir).find((n) => n.title === 'Deep')
    expect(note?.folder).toBe('A/B')
  })

  it('surfaces null id for un-backfilled foreign files without mutating them', () => {
    writeFileSync(join(dir, 'Raw.md'), '# raw\n')
    const note = listVaultNotes(dir).find((n) => n.title === 'Raw')
    expect(note?.id).toBeNull()
    // listing must not write to the file
    expect(readFileSync(join(dir, 'Raw.md'), 'utf-8')).toBe('# raw\n')
  })
})
