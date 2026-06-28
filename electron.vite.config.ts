import { resolve, join } from 'path'
import { createReadStream, cpSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

// Excalidraw fetches its fonts from a CDN by default; a local-first desktop app
// must render offline. Self-host them: serve from node_modules during dev and
// copy them next to index.html in the renderer build. The viewer points
// `window.EXCALIDRAW_ASSET_PATH` at the document base URL, so fonts resolve to
// `<base>fonts/...` under both the dev http server and the production file:// load.
function excalidrawAssetsPlugin(): Plugin {
  const fontsSrc = resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')
  return {
    name: 'excalidraw-assets',
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0])
        const filePath = join(fontsSrc, rel)
        // Traversal guard: only ever serve files inside the fonts dir.
        if (!filePath.startsWith(fontsSrc) || !existsSync(filePath)) return next()
        res.setHeader('Content-Type', 'font/woff2')
        createReadStream(filePath).pipe(res)
      })
    },
    writeBundle(options) {
      if (!existsSync(fontsSrc)) return
      cpSync(fontsSrc, join(options.dir || 'out/renderer', 'fonts'), { recursive: true })
    }
  }
}

function fixInteropPlugin(): Plugin {
  return {
    name: 'fix-interop-namespace',
    enforce: 'post',
    writeBundle(options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        const filePath = resolve(options.dir || '.', fileName)
        if (fileName.endsWith('.js') && existsSync(filePath)) {
          let code = readFileSync(filePath, 'utf-8')
          if (code.includes('getOwnPropertyDescriptor(e2, k2)')) {
            code = code.replace(
              /const d2 = Object\.getOwnPropertyDescriptor\(e2, k2\);/g,
              'const d2 = Object.getOwnPropertyDescriptor(e2, k2); if (!d2) continue;'
            )
            writeFileSync(filePath, code)
          }
        }
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@earendil-works/pi-coding-agent',
          '@earendil-works/pi-ai',
          '@earendil-works/pi-agent-core',
          'typebox',
          '@anthropic-ai/sdk',
          '@modelcontextprotocol/sdk',
          'dotenv',
          'ws',
          'diff',
          'mdast-util-from-markdown',
          'mdast-util-to-markdown',
          'mdast-util-gfm',
          'micromark-extension-gfm',
          'micromark-util-symbol',
          'yaml'
        ]
      }),
      fixInteropPlugin()
    ],
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'koffi'],
        output: {
          interop: 'auto'
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss(), excalidrawAssetsPlugin()]
  }
})
