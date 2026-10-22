/// <reference types="electron-vite/node" />

// docs/WHATS-NEW.md bundled as text (Vite `?raw`), parsed by @shared/whats-new.
declare module '*.md?raw' {
  const text: string
  export default text
}
