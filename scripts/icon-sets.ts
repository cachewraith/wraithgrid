// Build-time icon data for the icon picker, served to the renderer as `virtual:icon-sets`.
// Material Symbols ships every icon in six styles (8.9 MB); only one style is kept,
// filled + rounded, falling back to the base icon where no rounded one exists, so every
// icon in the picker looks alike. Lucide (one style) is kept whole. The renderer imports
// the module lazily, so the data is its own chunk and never slows startup.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin } from 'vite'

interface IconifyJson {
  icons: Record<string, { body: string; width?: number; height?: number }>
  /** Other names for an icon ("smartphone" → "mobile"); transformed ones are skipped. */
  aliases?: Record<string, { parent: string; [transform: string]: unknown }>
  width?: number
  height?: number
}

const STYLE_SUFFIX = /-(outline-rounded|outline-sharp|rounded|sharp|outline)$/

/** One body per Material concept: `name-rounded` if there is one, else `name`. */
export function trimMaterial(json: IconifyJson): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(json.icons)) {
    if (STYLE_SUFFIX.test(key)) continue
    const rounded = json.icons[`${key}-rounded`]
    out[key] = (rounded ?? json.icons[key]!).body
  }
  return withAliases(json, out, (k) => !STYLE_SUFFIX.test(k))
}

/** Adds plain aliases of kept icons under their own names, so familiar names are found. */
function withAliases(
  json: IconifyJson,
  out: Record<string, string>,
  keep: (alias: string) => boolean
): Record<string, string> {
  for (const [alias, a] of Object.entries(json.aliases ?? {})) {
    const plain = Object.keys(a).length === 1
    if (plain && keep(alias) && !(alias in out) && a.parent in out) out[alias] = out[a.parent]!
  }
  return out
}

/** Icons drawn on another grid than 24×24 would be cut or tiny; they are left out. */
export function bodies(json: IconifyJson): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, icon] of Object.entries(json.icons)) {
    if ((icon.width ?? json.width ?? 24) === 24 && (icon.height ?? json.height ?? 24) === 24)
      out[key] = icon.body
  }
  return withAliases(json, out, () => true)
}

const ID = 'virtual:icon-sets'
const RESOLVED = '\0' + ID

export function iconSets(): Plugin {
  // Resolved from the project root: works whether the config is bundled as ESM or CJS.
  const require = createRequire(path.join(process.cwd(), 'package.json'))
  const load = (pkg: string): IconifyJson =>
    JSON.parse(readFileSync(require.resolve(`${pkg}/icons.json`), 'utf8')) as IconifyJson
  return {
    name: 'wraithgrid-icon-sets',
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null
      const material = trimMaterial(load('@iconify-json/material-symbols'))
      const lucide = bodies(load('@iconify-json/lucide'))
      return `export default ${JSON.stringify({ material, lucide })}`
    }
  }
}
