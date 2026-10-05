// Ambient declarations for Vite virtual modules (no imports here, or they stop being ambient).

/** Bundled icon SVG bodies by set and name; built by scripts/icon-sets.ts. */
declare module 'virtual:icon-sets' {
  const sets: { material: Record<string, string>; lucide: Record<string, string> }
  export default sets
}
