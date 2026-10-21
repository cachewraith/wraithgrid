import type { ITheme } from '@xterm/xterm'
import { ANSI_NAMES, hexToRgba, themeTerminal, type ThemeFile } from '@shared/themes'
import type { TerminalPalette } from '@shared/types'

/** `#rrggbb` → `rgba(r, g, b, a)`. */
function alpha(hex: string, a: number): string {
  return hexToRgba(hex, a)
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

const ANSI_KEYS = ANSI_NAMES

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
const matchCache = new WeakMap<ThemeFile, ITheme>()

/** The app theme's own terminal colors as an xterm theme. */
function fromAppTheme(t: ThemeFile): ITheme {
  const c = themeTerminal(t)
  const sel = c.selection.length === 9 ? hexToRgba(c.selection) : alpha(c.selection, 0.3)
  const theme: ITheme = {
    background: c.background,
    foreground: c.foreground,
    cursor: c.cursor,
    cursorAccent: c.background,
    selectionBackground: sel,
    scrollbarSliderBackground: alpha(c.foreground, 0.2),
    scrollbarSliderHoverBackground: alpha(c.foreground, 0.35),
    scrollbarSliderActiveBackground: alpha(c.cursor, 0.5)
  }
  for (const k of ANSI_KEYS) theme[k] = c[k]
  return theme
}

/**
 * The xterm theme for the current settings: `match` follows the drawn app theme (accent
 * included), the rest are fixed schemes. Cached, so the same inputs return the same object
 * and it can be used straight from a store selector.
 */
export function terminalTheme(palette: TerminalPalette, drawn: ThemeFile): ITheme {
  if (palette === 'match') {
    let t = matchCache.get(drawn)
    if (!t) matchCache.set(drawn, (t = fromAppTheme(drawn)))
    return t
  }
  let t = cache.get(palette)
  if (!t) cache.set(palette, (t = fromScheme(SCHEMES[palette])))
  return t
}

/** Requested font first, bundled JetBrains Mono next, then the system monospace font. */
export function terminalFontStack(family: string): string {
  return `'${family}', 'JetBrains Mono', ui-monospace, monospace`
}
