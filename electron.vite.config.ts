import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias }
  },
  preload: {
    resolve: { alias },
    // Sandboxed preloads cannot require node_modules; bundle everything into one file.
    build: { externalizeDeps: false }
  },
  renderer: {
    resolve: { alias },
    plugins: [react()]
  }
})
