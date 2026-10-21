// App themes: the five built in, and theme files people make (~/.wraithgrid/themes/*.json).
// A theme is colors only. Every value is checked against a strict hex pattern, so a theme
// file can never carry CSS or script; the renderer sets the values as CSS variables.
import { z } from 'zod'
import type { AccentName, ThemeName } from './types'

/** A theme file's color names → the CSS variables they set (tokens.css). */
export const THEME_COLOR_VARS = {
  bg: '--bg',
  sidebar: '--bg2',
  panel: '--panel',
  raised: '--raise',
  line: '--line',
  lineStrong: '--line2',
  text: '--tx',
  muted: '--mu',
  faint: '--fa',
  accent: '--acc',
  accentText: '--acct',
  accentFill: '--accf',
  accentFillHover: '--accf-h',
  onAccent: '--on-acc',
  terminal: '--term',
  ok: '--ok',
  warn: '--warn',
  err: '--err',
  info: '--cy',
  selection: '--sel',
  hover: '--hover',
  frame: '--frame'
} as const
export type ThemeColorName = keyof typeof THEME_COLOR_VARS

// prettier-ignore
export const ANSI_NAMES = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const
export type AnsiName = (typeof ANSI_NAMES)[number]

export interface ThemeTerminalColors extends Partial<Record<AnsiName, string>> {
  background?: string
  foreground?: string
  cursor?: string
  selection?: string
}

/** A theme as a file holds it (and as the built-ins are written). */
export interface ThemeFile {
  name: string
  mode: ThemeName
  author?: string
  colors: Partial<Record<ThemeColorName, string>> & { bg: string; text: string; accent: string }
  terminal?: ThemeTerminalColors
}

/** A theme the app can draw: built in, or loaded from the themes folder. */
export interface AppTheme extends ThemeFile {
  id: string
  builtIn: boolean
}

export const THEMES_FILE_MAX = 64 * 1024
export const THEMES_MAX = 100

/** `#rgb`, `#rrggbb` or `#rrggbbaa`, stored as lowercase `#rrggbb[aa]`. */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
export const themeColorSchema = z
  .string()
  .regex(HEX, 'must be a hex color like #1f2937')
  .transform((s) => {
    const v = s.toLowerCase()
    return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v
  })

const optionalColors = Object.fromEntries(
  Object.keys(THEME_COLOR_VARS).map((k) => [k, themeColorSchema.optional()])
) as Record<ThemeColorName, z.ZodOptional<typeof themeColorSchema>>

export const themeFileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[^\p{Cc}<>]+$/u, 'has characters a name cannot use'),
  mode: z.enum(['dark', 'light']),
  author: z
    .string()
    .trim()
    .max(60)
    .regex(/^[^\p{Cc}<>]*$/u)
    .optional(),
  colors: z
    .object({
      ...optionalColors,
      bg: themeColorSchema,
      text: themeColorSchema,
      accent: themeColorSchema
    })
    .strict(),
  terminal: z
    .object({
      background: themeColorSchema.optional(),
      foreground: themeColorSchema.optional(),
      cursor: themeColorSchema.optional(),
      selection: themeColorSchema.optional(),
      ...(Object.fromEntries(ANSI_NAMES.map((k) => [k, themeColorSchema.optional()])) as Record<
        AnsiName,
        z.ZodOptional<typeof themeColorSchema>
      >)
    })
    .strict()
    .optional()
})

export type ThemeParse = { ok: true; theme: ThemeFile } | { ok: false; error: string }

/** Validates an untrusted theme file's parsed JSON. */
export function parseThemeFile(raw: unknown): ThemeParse {
  const r = themeFileSchema.safeParse(raw)
  if (!r.success) {
    const issue = r.error.issues[0]!
    const where = issue.path.length ? `${issue.path.join('.')}: ` : ''
    return { ok: false, error: `${where}${issue.message}` }
  }
  // Drop the keys zod left undefined, so the saved file stays as small as it was written.
  return { ok: true, theme: JSON.parse(JSON.stringify(r.data)) as ThemeFile }
}

/** A theme name as a file name / id: `My Ocean!` → `my-ocean`. */
export function themeSlug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'theme'
}

// ---- Built-in themes --------------------------------------------------------------

const ansi = (a: string[]): Record<AnsiName, string> =>
  Object.fromEntries(ANSI_NAMES.map((k, i) => [k, a[i]!])) as Record<AnsiName, string>

// prettier-ignore
export const BUILT_IN_THEMES: AppTheme[] = [
  {
    id: 'wraith',
    builtIn: true,
    name: 'Wraith',
    mode: 'dark',
    colors: {
      bg: '#1c1c1c', sidebar: '#171717', panel: '#232323', raised: '#2a2a2a',
      line: '#2b2b2b', lineStrong: '#3a3a3a', text: '#ececec', muted: '#b4b4b4', faint: '#8f8f8f',
      accent: '#7c5cff', accentText: '#a996ff', accentFill: '#6a4cf0', accentFillHover: '#5a3de0',
      onAccent: '#ffffff', terminal: '#1c1c1c', ok: '#4ade80', warn: '#fbbf24', err: '#fb7185',
      info: '#7dd3fc', selection: '#2a2a2a', hover: '#242424', frame: '#121212'
    },
    terminal: {
      background: '#1c1c1c', foreground: '#ececec', cursor: '#a996ff', selection: '#7c5cff61',
      ...ansi([
        '#2b2b2b', '#fb7185', '#4ade80', '#fbbf24', '#8ab4ff', '#a996ff', '#7dd3fc', '#ececec',
        '#8f8f8f', '#fda4af', '#86efac', '#fde68a', '#b4ccff', '#c4b8ff', '#bae6fd', '#ffffff'
      ])
    }
  },
  {
    id: 'midnight',
    builtIn: true,
    name: 'Midnight',
    mode: 'dark',
    colors: {
      bg: '#0f1420', sidebar: '#0b0f19', panel: '#151b29', raised: '#1b2333',
      line: '#1e2636', lineStrong: '#2b3548', text: '#e2e8f5', muted: '#a6b0c3', faint: '#7c879c',
      accent: '#22d3ee', accentText: '#67e8f9', accentFill: '#0891b2', accentFillHover: '#0e7490',
      onAccent: '#ffffff', terminal: '#0f1420', ok: '#4ade80', warn: '#fbbf24', err: '#fb7185',
      info: '#7dd3fc', selection: '#1b2333', hover: '#141a27', frame: '#080b12'
    },
    terminal: {
      background: '#0f1420', foreground: '#e2e8f5', cursor: '#67e8f9', selection: '#22d3ee4d',
      ...ansi([
        '#1e2636', '#fb7185', '#4ade80', '#fbbf24', '#7aa2f7', '#c4a7ff', '#67e8f9', '#e2e8f5',
        '#7c879c', '#fda4af', '#86efac', '#fde68a', '#a5c0ff', '#ddd0ff', '#a5f3fc', '#ffffff'
      ])
    }
  },
  {
    id: 'clay',
    builtIn: true,
    name: 'Clay',
    mode: 'dark',
    colors: {
      bg: '#1f1b18', sidebar: '#191613', panel: '#26211d', raised: '#2e2823',
      line: '#2f2924', lineStrong: '#3f3730', text: '#f0e9e1', muted: '#c2b6a8', faint: '#968a7d',
      accent: '#d97757', accentText: '#eba184', accentFill: '#c8643f', accentFillHover: '#b05533',
      onAccent: '#ffffff', terminal: '#1f1b18', ok: '#8fcf7a', warn: '#f2b84b', err: '#f07a7a',
      info: '#8ec5d6', selection: '#2e2823', hover: '#26211d', frame: '#12100e'
    },
    terminal: {
      background: '#1f1b18', foreground: '#f0e9e1', cursor: '#eba184', selection: '#d977574d',
      ...ansi([
        '#2f2924', '#f07a7a', '#8fcf7a', '#f2b84b', '#8fb3e0', '#d9a0c8', '#8ec5d6', '#e8dfd4',
        '#968a7d', '#f7a1a1', '#b2e0a2', '#f7d08a', '#b3cdef', '#e8c0dc', '#b4dce8', '#fffaf3'
      ])
    }
  },
  {
    id: 'daylight',
    builtIn: true,
    name: 'Daylight',
    mode: 'light',
    colors: {
      bg: '#ffffff', sidebar: '#f9f9f8', panel: '#ffffff', raised: '#efefed',
      line: '#e7e7e4', lineStrong: '#d4d4d0', text: '#1f1f1f', muted: '#4a4a4a', faint: '#6b6b6b',
      accent: '#7c5cff', accentText: '#5a3de0', accentFill: '#6a4cf0', accentFillHover: '#5a3de0',
      onAccent: '#ffffff', terminal: '#ffffff', ok: '#15803d', warn: '#a16207', err: '#be123c',
      info: '#0369a1', selection: '#ececea', hover: '#f2f2f0', frame: '#e8e8e7'
    },
    terminal: {
      background: '#ffffff', foreground: '#1f1f1f', cursor: '#5a3de0', selection: '#5a3de038',
      ...ansi([
        '#1f1f1f', '#be123c', '#15803d', '#a16207', '#1d4ed8', '#5a3de0', '#0369a1', '#d4d4d0',
        '#6b6b6b', '#e11d48', '#16a34a', '#ca8a04', '#2563eb', '#6d4cf0', '#0284c7', '#4a4a4a'
      ])
    }
  },
  {
    id: 'paper',
    builtIn: true,
    name: 'Paper',
    mode: 'light',
    colors: {
      bg: '#fbf8f1', sidebar: '#f3eee3', panel: '#fffdf8', raised: '#ece5d6',
      line: '#e6dfcf', lineStrong: '#d3c9b5', text: '#2b2620', muted: '#574f44', faint: '#7a7063',
      accent: '#2f5fb3', accentText: '#244c94', accentFill: '#2f5fb3', accentFillHover: '#244c94',
      onAccent: '#ffffff', terminal: '#fbf8f1', ok: '#2f7d32', warn: '#9a6700', err: '#b42318',
      info: '#1f6f8b', selection: '#ece5d6', hover: '#f4efe4', frame: '#e8e1d2'
    },
    terminal: {
      background: '#fbf8f1', foreground: '#2b2620', cursor: '#244c94', selection: '#2f5fb338',
      ...ansi([
        '#2b2620', '#b42318', '#2f7d32', '#9a6700', '#2f5fb3', '#8a3fa0', '#1f6f8b', '#d3c9b5',
        '#7a7063', '#d1361f', '#3c9a40', '#b98100', '#4876c9', '#a457bb', '#2a88a8', '#574f44'
      ])
    }
  }
]

/** The theme a mode falls back to when the picked one is gone. */
export const DEFAULT_THEME_ID: Record<ThemeName, string> = { dark: 'wraith', light: 'daylight' }

/** The picked theme for a mode, or that mode's default when it is missing or the wrong mode. */
export function pickTheme(themes: readonly AppTheme[], id: string, mode: ThemeName): AppTheme {
  const t = themes.find((x) => x.id === id && x.mode === mode)
  return t ?? themes.find((x) => x.id === DEFAULT_THEME_ID[mode])!
}

// ---- Accent override -----------------------------------------------------------------

export interface AccentColors {
  accent: string
  accentText: string
  accentFill: string
  accentFillHover: string
  onAccent: string
}

// prettier-ignore
export const ACCENT_PRESETS: Record<AccentName, Record<ThemeName, AccentColors>> = {
  violet: {
    dark: { accent: '#7c5cff', accentText: '#a996ff', accentFill: '#6a4cf0', accentFillHover: '#5a3de0', onAccent: '#ffffff' },
    light: { accent: '#7c5cff', accentText: '#5a3de0', accentFill: '#6a4cf0', accentFillHover: '#5a3de0', onAccent: '#ffffff' }
  },
  blue: {
    dark: { accent: '#3b82f6', accentText: '#93c5fd', accentFill: '#2563eb', accentFillHover: '#1d4ed8', onAccent: '#ffffff' },
    light: { accent: '#3b82f6', accentText: '#1d4ed8', accentFill: '#2563eb', accentFillHover: '#1d4ed8', onAccent: '#ffffff' }
  },
  teal: {
    dark: { accent: '#14b8a6', accentText: '#5eead4', accentFill: '#0f766e', accentFillHover: '#115e59', onAccent: '#ffffff' },
    light: { accent: '#14b8a6', accentText: '#0f766e', accentFill: '#0f766e', accentFillHover: '#115e59', onAccent: '#ffffff' }
  },
  amber: {
    dark: { accent: '#f59e0b', accentText: '#fcd34d', accentFill: '#f59e0b', accentFillHover: '#d97706', onAccent: '#1c1403' },
    light: { accent: '#f59e0b', accentText: '#b45309', accentFill: '#f59e0b', accentFillHover: '#d97706', onAccent: '#1c1403' }
  },
  rose: {
    dark: { accent: '#f43f5e', accentText: '#fda4af', accentFill: '#e11d48', accentFillHover: '#be123c', onAccent: '#ffffff' },
    light: { accent: '#f43f5e', accentText: '#be123c', accentFill: '#e11d48', accentFillHover: '#be123c', onAccent: '#ffffff' }
  }
}

/** A theme with an accent laid over it (`theme` keeps its own). */
export function withAccent(t: ThemeFile, accent: AccentName | 'theme'): ThemeFile {
  if (accent === 'theme') return t
  const a = ACCENT_PRESETS[accent][t.mode]
  return {
    ...t,
    colors: { ...t.colors, ...a },
    // The terminal cursor and selection follow the accent too.
    terminal: {
      ...t.terminal,
      cursor: a.accentText,
      selection: `${a.accent}${t.mode === 'dark' ? '61' : '38'}`
    }
  }
}

// ---- Theme → CSS variables -------------------------------------------------------------

/** Status colors a theme file may leave out, taken from the default theme of its mode. */
const BASE_STATUS: Record<ThemeName, Record<'ok' | 'warn' | 'err' | 'info', string>> = {
  dark: { ok: '#4ade80', warn: '#fbbf24', err: '#fb7185', info: '#7dd3fc' },
  light: { ok: '#15803d', warn: '#a16207', err: '#be123c', info: '#0369a1' }
}

/**
 * Every CSS variable a theme sets. Colors the file leaves out are mixed from the ones it
 * gives (bg, text, accent), so a three-color theme still looks finished.
 */
export function themeVars(t: ThemeFile): Record<string, string> {
  const dark = t.mode === 'dark'
  const mix = (a: string, pct: number, b: string): string =>
    `color-mix(in srgb, ${a} ${pct}%, ${b})`
  const derived: Record<ThemeColorName, string> = {
    bg: t.colors.bg,
    text: t.colors.text,
    accent: t.colors.accent,
    sidebar: mix('var(--bg)', dark ? 88 : 97, dark ? '#000' : 'var(--tx)'),
    panel: mix('var(--bg)', 95, 'var(--tx)'),
    raised: mix('var(--bg)', 90, 'var(--tx)'),
    line: mix('var(--bg)', 89, 'var(--tx)'),
    lineStrong: mix('var(--bg)', 80, 'var(--tx)'),
    muted: mix('var(--tx)', 76, 'var(--bg)'),
    faint: mix('var(--tx)', 56, 'var(--bg)'),
    accentText: mix('var(--acc)', dark ? 65 : 78, dark ? '#fff' : '#000'),
    accentFill: 'var(--acc)',
    accentFillHover: mix('var(--acc)', 85, '#000'),
    onAccent: '#ffffff',
    terminal: 'var(--bg)',
    ...BASE_STATUS[t.mode],
    selection: mix('var(--bg)', 90, 'var(--tx)'),
    hover: mix('var(--bg)', 95, 'var(--tx)'),
    frame: mix('var(--bg2)', dark ? 78 : 93, '#000')
  }
  const vars: Record<string, string> = {}
  for (const [name, cssVar] of Object.entries(THEME_COLOR_VARS))
    vars[cssVar] = t.colors[name as ThemeColorName] ?? derived[name as ThemeColorName]
  // The rest of tokens.css follows from those.
  Object.assign(vars, {
    '--selr': 'var(--line2)',
    '--hover-line': mix('var(--fa)', 70, 'var(--bg)'),
    '--addbg': mix('var(--ok)', 10, 'transparent'),
    '--delbg': mix('var(--err)', 10, 'transparent'),
    '--scrim': dark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(0, 0, 0, 0.25)',
    '--banner-bg': mix('var(--warn)', 9, 'var(--bg)'),
    '--banner-line': mix('var(--warn)', 45, 'transparent'),
    '--banner-title': mix('var(--warn)', 65, 'var(--tx)'),
    '--logo-line': mix('var(--fa)', 75, 'var(--bg)'),
    '--empty-line': 'var(--line2)',
    '--mini-hover': mix('var(--acc)', 45, 'var(--bg)'),
    '--solid': 'var(--tx)',
    '--solid-h': mix('var(--tx)', 80, dark ? '#fff' : '#000'),
    '--on-solid': 'var(--bg2)'
  })
  return vars
}

/** `#rrggbb[aa]` → `rgba(…)`; xterm and color math want one form. */
export function hexToRgba(hex: string, a?: number): string {
  const n = parseInt(hex.slice(1, 7), 16)
  const own = hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1
  const al = Math.round((a ?? own) * 1000) / 1000
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${al})`
}

/** The terminal colors for a theme: its own, then ones made from its app colors. */
export function themeTerminal(t: ThemeFile): Required<ThemeTerminalColors> {
  const base = BUILT_IN_THEMES.find((x) => x.id === DEFAULT_THEME_ID[t.mode])!.terminal!
  const c = t.colors
  const status = { ...BASE_STATUS[t.mode], ...c }
  const bg = t.terminal?.background ?? c.terminal ?? c.bg
  return {
    ...(base as Required<ThemeTerminalColors>),
    // A theme that names its status colors gets them in the terminal too.
    red: status.err,
    green: status.ok,
    yellow: status.warn,
    cyan: status.info,
    magenta: c.accentText ?? c.accent,
    background: bg,
    foreground: c.text,
    cursor: c.accentText ?? c.accent,
    selection: `${c.accent.slice(0, 7)}${t.mode === 'dark' ? '61' : '38'}`,
    ...t.terminal
  }
}
