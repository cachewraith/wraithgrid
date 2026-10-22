// WCAG contrast for the theme editor (#24): which text and button colors are hard to read on
// what they sit on, and a nearby color that passes. Hex in, numbers out; no DOM.
import type { ThemeColorName, ThemeFile } from './themes'

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (c: [number, number, number]): string =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/** Relative luminance (WCAG 2.x) of `#rrggbb[aa]` (alpha ignored). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two colors, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** `fg` moved toward black or white (whichever gains contrast) until it reaches `need`. */
export function passingColor(fg: string, bg: string, need: number): string {
  const towards: [number, number, number] = luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255]
  const from = rgb(fg)
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = from.map((v, i) => v + (towards[i]! - v) * t) as [number, number, number]
    if (contrastRatio(toHex(c), bg) >= need) return toHex(c)
  }
  return toHex(towards)
}

export interface ContrastIssue {
  /** The color to change, and what it is drawn on. */
  fg: ThemeColorName
  bg: ThemeColorName
  label: string
  ratio: number
  need: number
  /** The nearest color that passes. */
  fix: string
}

/** Text and buttons, and the WCAG AA level each needs (4.5 text, 3 large/UI). */
const PAIRS: { fg: ThemeColorName; bg: ThemeColorName; label: string; need: number }[] = [
  { fg: 'text', bg: 'bg', label: 'Text on the background', need: 4.5 },
  { fg: 'text', bg: 'panel', label: 'Text on menus and cards', need: 4.5 },
  { fg: 'muted', bg: 'bg', label: 'Muted text on the background', need: 4.5 },
  { fg: 'faint', bg: 'bg', label: 'Hints and timestamps on the background', need: 4.5 },
  { fg: 'accentText', bg: 'bg', label: 'Links and accent text', need: 4.5 },
  { fg: 'onAccent', bg: 'accentFill', label: 'Button text on accent buttons', need: 4.5 },
  { fg: 'text', bg: 'userBubble', label: 'Your messages in chat', need: 4.5 },
  { fg: 'err', bg: 'bg', label: 'Error text', need: 3 },
  { fg: 'warn', bg: 'bg', label: 'Warnings', need: 3 }
]

const HEX6 = /^#[0-9a-f]{6}([0-9a-f]{2})?$/

/** The pairs of a theme's own colors that fall short (colors it leaves out are not judged). */
export function contrastIssues(t: ThemeFile): ContrastIssue[] {
  const c = t.colors as Partial<Record<ThemeColorName, string>>
  const out: ContrastIssue[] = []
  for (const p of PAIRS) {
    const fg = c[p.fg]
    const bg = c[p.bg]
    if (!fg || !bg || !HEX6.test(fg) || !HEX6.test(bg)) continue
    const ratio = contrastRatio(fg, bg)
    if (ratio < p.need)
      out.push({ ...p, ratio: Math.floor(ratio * 10) / 10, fix: passingColor(fg, bg, p.need) })
  }
  return out
}
