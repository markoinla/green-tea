import { describe, it, expect } from 'vitest'
import { serializeBlocks } from './serialize'
import { deserializeMarkdown } from './deserialize'

function roundtrip(md: string): string {
  return serializeBlocks(deserializeMarkdown(md))
}

describe('markdown roundtrip', () => {
  it('preserves paragraph content', () => {
    expect(roundtrip('Hello world')).toBe('Hello world')
  })

  it('preserves headings', () => {
    const md = '# Title'
    expect(roundtrip(md)).toBe('# Title')
  })

  it('preserves blockquote', () => {
    expect(roundtrip('> A quote')).toBe('> A quote')
  })

  it('preserves image', () => {
    const md = '![alt](https://example.com/img.png)'
    expect(roundtrip(md)).toBe(md)
  })

  it('preserves list items', () => {
    const md = '- Item 1\n\n- Item 2'
    const result = roundtrip(md)
    expect(result).toContain('- Item 1')
    expect(result).toContain('- Item 2')
  })

  it('preserves task items', () => {
    const md = '- [x] Done\n\n- [ ] Not done'
    const result = roundtrip(md)
    expect(result).toContain('[x] Done')
    expect(result).toContain('[ ] Not done')
  })

  it('preserves nested hierarchy', () => {
    const md = '- Parent\n  - Child'
    const result = roundtrip(md)
    expect(result).toContain('- Parent')
    expect(result).toContain('  - Child')
  })

  it('preserves code blocks', () => {
    const md = '```\nconst x = 1;\n```'
    const result = roundtrip(md)
    expect(result).toContain('```')
    expect(result).toContain('const x = 1;')
  })

  it('preserves tables', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const result = roundtrip(md)
    expect(result).toContain('| A')
    expect(result).toContain('| B')
    expect(result).toContain('| 1')
    expect(result).toContain('| 2')
    expect(result).toContain('---')
  })

  it('handles complex mixed documents', () => {
    const md = [
      '# Project Notes',
      '',
      '## Tasks',
      '',
      '- [x] Setup database',
      '',
      '- [ ] Write tests',
      '',
      '> Important note',
      '',
      '```',
      'npm test',
      '```',
      '',
      '| Name | Done |',
      '| --- | --- |',
      '| Tests | No |'
    ].join('\n')

    const result = roundtrip(md)
    expect(result).toContain('# Project Notes')
    expect(result).toContain('## Tasks')
    expect(result).toContain('[x] Setup database')
    expect(result).toContain('[ ] Write tests')
    expect(result).toContain('> Important note')
    expect(result).toContain('npm test')
    expect(result).toContain('| Name')
  })
})
