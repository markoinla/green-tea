import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { walkArtifactAssets } from './asset-walker'

describe('walkArtifactAssets', () => {
  let root: string
  let artDir: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'gt-art-'))
    artDir = join(root, 'artifact')
    mkdirSync(join(artDir, 'img'), { recursive: true })
    // A secret sibling OUTSIDE the artifact dir that a ../ escape would target.
    writeFileSync(join(root, 'secret.md'), '# secret')

    writeFileSync(join(artDir, 'chart.js'), 'console.log(1)')
    writeFileSync(join(artDir, 'img', 'logo.png'), 'PNGDATA')
    writeFileSync(
      join(artDir, 'index.html'),
      [
        '<!doctype html><html><head>',
        '<style>body { background: url("./img/logo.png"); }</style>',
        '<link rel="stylesheet" href="https://cdn.example.com/x.css">',
        '</head><body>',
        '<script src="./chart.js"></script>',
        '<img src="./img/logo.png">',
        '<a href="../secret.md">escape</a>',
        '<a href="gt-file://other/index.html">gtfile</a>',
        '</body></html>'
      ].join('\n')
    )
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('collects exactly the referenced in-dir files and rejects ../ escapes', () => {
    const result = walkArtifactAssets(join(artDir, 'index.html'))

    const paths = result.assets.map((a) => a.path).sort()
    expect(paths).toEqual(['chart.js', 'img/logo.png'])

    // Entry HTML returned verbatim.
    expect(result.entryHtml).toContain('<img src="./img/logo.png">')

    // The ../ escape and the gt-file:// + remote refs are NOT collected.
    expect(paths).not.toContain('../secret.md')
    expect(result.warnings.some((w) => w.includes('secret.md'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('cdn.example.com'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('gt-file://'))).toBe(true)

    // Base64 content is present.
    const chart = result.assets.find((a) => a.path === 'chart.js')
    expect(Buffer.from(chart!.contentBase64, 'base64').toString()).toBe('console.log(1)')
  })
})
