import type { ITheme } from '@xterm/xterm'
import type { AccentName, TerminalPalette, ThemeName } from '@shared/types'

/** `#rrggbb` → `rgba(r, g, b, a)`. */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// Built from the design tokens so terminals follow the app theme.
export const TERMINAL_THEMES: Record<ThemeName, ITheme> = {
  dark: {
    background: '#0c0c15',
    foreground: '#e7e6f2',
    cursor: '#a996ff',
    cursorAccent: '#0c0c15',
    selectionBackground: 'rgba(124, 92, 255, 0.38)',
    scrollbarSliderBackground: 'rgba(138, 137, 168, 0.25)',
    scrollbarSliderHoverBackground: 'rgba(138, 137, 168, 0.4)',
    scrollbarSliderActiveBackground: 'rgba(169, 150, 255, 0.5)',
    black: '#232338',
    red: '#fb7185',
    green: '#4ade80',
    yellow: '#fbbf24',
    blue: '#8ab4ff',
    magenta: '#a996ff',
    cyan: '#7dd3fc',
    white: '#e7e6f2',
    brightBlack: '#8a89a8',
    brightRed: '#fda4af',
    brightGreen: '#86efac',
    brightYellow: '#fde68a',
    brightBlue: '#b4ccff',
    brightMagenta: '#c4b8ff',
    brightCyan: '#bae6fd',
    brightWhite: '#ffffff'
  },
  light: {
    background: '#fbfaff',
    foreground: '#17162a',
    cursor: '#5a3de0',
    cursorAccent: '#fbfaff',
    selectionBackground: 'rgba(90, 61, 224, 0.22)',
    scrollbarSliderBackground: 'rgba(88, 86, 115, 0.25)',
    scrollbarSliderHoverBackground: 'rgba(88, 86, 115, 0.4)',
    scrollbarSliderActiveBackground: 'rgba(90, 61, 224, 0.45)',
    black: '#17162a',
    red: '#be123c',
    green: '#15803d',
    yellow: '#a16207',
    blue: '#1d4ed8',
    magenta: '#5a3de0',
    cyan: '#0369a1',
    white: '#c3c0d8',
    brightBlack: '#585673',
    brightRed: '#e11d48',
    brightGreen: '#16a34a',
    brightYellow: '#ca8a04',
    brightBlue: '#2563eb',
    brightMagenta: '#6d4cf0',
    brightCyan: '#0284c7',
    brightWhite: '#43415c'
  }
}

/** Cursor and selection colors per accent, mirroring --acct/--acc in tokens.css. */
// prettier-ignore
const ACCENT_TERMINAL: Record<AccentName, Record<ThemeName, { cursor: string; sel: string }>> = {
  violet: { dark: { cursor: '#a996ff', sel: '#7c5cff' }, light: { cursor: '#5a3de0', sel: '#5a3de0' } },
  blue: { dark: { cursor: '#93c5fd', sel: '#3b82f6' }, light: { cursor: '#1d4ed8', sel: '#2563eb' } },
  teal: { dark: { cursor: '#5eead4', sel: '#14b8a6' }, light: { cursor: '#0f766e', sel: '#0d9488' } },
  amber: { dark: { cursor: '#fcd34d', sel: '#f59e0b' }, light: { cursor: '#b45309', sel: '#d97706' } },
  rose: { dark: { cursor: '#fda4af', sel: '#f43f5e' }, light: { cursor: '#be123c', sel: '#e11d48' } }
}

interface Scheme {
  label: string
  dark: boolean
  bg: string
  fg: string
  cursor: string
  selection: string
  /** black, red, green, yellow, blue, magenta, cyan, white, then the bright eight. */
  ansi: readonly string[]
}

// prettier-ignore
const SCHEMES: Record<Exclude<TerminalPalette, 'match'>, Scheme> = {
  dracula: {
    label: 'Dracula',
    dark: true,
    bg: '#282a36',
    fg: '#f8f8f2',
    cursor: '#f8f8f2',
    selection: '#44475a',
    ansi: [
      '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'
    ]
  },
  nord: {
    label: 'Nord',
    dark: true,
    bg: '#2e3440',
    fg: '#d8dee9',
    cursor: '#d8dee9',
    selection: '#434c5e',
    ansi: [
      '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#616e88', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'
    ]
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    dark: true,
    bg: '#1a1b26',
    fg: '#c0caf5',
    cursor: '#c0caf5',
    selection: '#33467c',
    ansi: [
      '#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
      '#565f89', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'
    ]
  },
  'gruvbox-dark': {
    label: 'Gruvbox',
    dark: true,
    bg: '#282828',
    fg: '#ebdbb2',
    cursor: '#ebdbb2',
    selection: '#504945',
    ansi: [
      '#3c3836', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
      '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'
    ]
  },
  'solarized-dark': {
    label: 'Solarized Dark',
    dark: true,
    bg: '#002b36',
    fg: '#93a1a1',
    cursor: '#93a1a1',
    selection: '#073642',
    ansi: [
      '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#657b83', '#cb4b16', '#859900', '#b58900', '#268bd2', '#6c71c4', '#2aa198', '#fdf6e3'
    ]
  },
  'solarized-light': {
    label: 'Solarized Light',
    dark: false,
    bg: '#fdf6e3',
    fg: '#586e75',
    cursor: '#586e75',
    selection: '#eee8d5',
    ansi: [
      '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#93a1a1',
      '#839496', '#cb4b16', '#859900', '#b58900', '#268bd2', '#6c71c4', '#2aa198', '#073642'
    ]
  }
}

// prettier-ignore
const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

function fromScheme(s: Scheme): ITheme {
  const theme: ITheme = {
    background: s.bg,
    foreground: s.fg,
    cursor: s.cursor,
    cursorAccent: s.bg,
    selectionBackground: s.selection,
    scrollbarSliderBackground: alpha(s.fg, 0.2),
    scrollbarSliderHoverBackground: alpha(s.fg, 0.35),
    scrollbarSliderActiveBackground: alpha(s.fg, 0.5)
  }
  ANSI_KEYS.forEach((k, i) => (theme[k] = s.ansi[i]))
  return theme
}

export const PALETTE_LABEL: Record<TerminalPalette, string> = {
  match: 'Match app',
  ...(Object.fromEntries(Object.entries(SCHEMES).map(([id, s]) => [id, s.label])) as Record<
    Exclude<TerminalPalette, 'match'>,
    string
  >)
}

const cache = new Map<string, ITheme>()

/**
 * The xterm theme for the current settings. Results are cached, so the same inputs
 * always return the same object and can be used straight from a store selector.
 */
export function terminalTheme(
  palette: TerminalPalette,
  theme: ThemeName,
  accent: AccentName
): ITheme {
  const key = palette === 'match' ? `match:${theme}:${accent}` : palette
  let t = cache.get(key)
  if (!t) {
    if (palette === 'match') {
      const a = ACCENT_TERMINAL[accent][theme]
      t = {
        ...TERMINAL_THEMES[theme],
        cursor: a.cursor,
        selectionBackground: alpha(a.sel, theme === 'dark' ? 0.38 : 0.22),
        scrollbarSliderActiveBackground: alpha(a.cursor, theme === 'dark' ? 0.5 : 0.45)
      }
    } else {
      t = fromScheme(SCHEMES[palette])
    }
    cache.set(key, t)
  }
  return t
}

/** Requested font first, bundled JetBrains Mono next, then the system monospace font. */
export function terminalFontStack(family: string): string {
  return `'${family}', 'JetBrains Mono', ui-monospace, monospace`
}
