import type { ITheme } from '@xterm/xterm'
import type { ThemeName } from '@shared/types'

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

/** Requested font first, bundled JetBrains Mono next, then the system monospace font. */
export function terminalFontStack(family: string): string {
  return `'${family}', 'JetBrains Mono', ui-monospace, monospace`
}
