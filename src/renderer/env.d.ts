/// <reference types="vite/client" />
import type { WraithApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    /** Exposed by src/preload/index.ts. */
    wraith: WraithApi
  }
}

export {}
