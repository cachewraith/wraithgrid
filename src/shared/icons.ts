// What an icon value in config means. One string field per account, workspace and folder:
//   ''                       → the first letter of the name
//   'material:rocket-launch' → a bundled Material Symbols icon (filled, rounded)
//   'lucide:git-branch'      → a bundled Lucide icon
//   anything else            → an emoji, drawn as text
// Icon names are looked up in data shipped with the app; config never supplies markup.

export const ICON_SETS = ['material', 'lucide'] as const
export type IconSetName = (typeof ICON_SETS)[number]

export const ICON_SET_LABEL: Record<IconSetName, string> = {
  material: 'Material',
  lucide: 'Lucide'
}

/** Longest stored icon value (set prefix + name). */
export const ICON_MAX = 64
/** Longest emoji typed into the custom field. */
export const EMOJI_MAX = 16

const GLYPH = /^(material|lucide):([a-z0-9]+(?:-[a-z0-9]+)*)$/

export type ParsedIcon =
  | { kind: 'letter' }
  | { kind: 'emoji'; text: string }
  | { kind: 'glyph'; set: IconSetName; name: string }

export function parseIcon(value: string): ParsedIcon {
  if (!value) return { kind: 'letter' }
  const m = GLYPH.exec(value)
  if (m) return { kind: 'glyph', set: m[1] as IconSetName, name: m[2]! }
  return { kind: 'emoji', text: value }
}

export function glyphId(set: IconSetName, name: string): string {
  return `${set}:${name}`
}

/** Tints offered in the picker. '' keeps the neutral grey. */
export const ICON_COLORS = [
  '',
  '#7c5cff',
  '#3b82f6',
  '#14b8a6',
  '#22c55e',
  '#f5a524',
  '#f97316',
  '#f43f5e',
  '#ec4899'
] as const
