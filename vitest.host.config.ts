// The host parity suite (ADR 0004): starts the Node and the Rust pty host, so it needs
// `bun run build` and `cargo build --release` first; `bun run test:host` does all three.
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    include: ['tests/host/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    fileParallelism: false
  }
})
