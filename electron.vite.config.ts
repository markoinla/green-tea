import { resolve } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

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
          '@mariozechner/pi-coding-agent',
          '@mariozechner/pi-ai',
          '@mariozechner/pi-agent-core',
          '@sinclair/typebox',
          '@anthropic-ai/sdk',
          '@modelcontextprotocol/sdk',
          'dotenv',
          'ws',
          'diff'
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
    plugins: [react(), tailwindcss()]
  }
})
