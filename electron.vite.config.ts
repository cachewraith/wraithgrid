import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { iconSets } from './scripts/icon-sets'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    // The pty host is a second entry: same Node target and externals, its own process.
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // An entry of its own so it stays in out/main: it resolves files from __dirname.
          app: resolve(__dirname, 'src/main/app.ts'),
          // `wraithgrid <command>`, run as plain Node by index.ts.
          cli: resolve(__dirname, 'src/main/cli-entry.ts'),
          host: resolve(__dirname, 'src/host/index.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias },
    // Sandboxed preloads cannot require node_modules; bundle everything into one file.
    build: { externalizeDeps: false }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), iconSets()]
  }
})
