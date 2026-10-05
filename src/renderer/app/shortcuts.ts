import type { Direction } from '../layout/focus'

/**
 * On macOS app shortcuts use Cmd (⌘) where Linux and Windows use Ctrl, as in every Mac
 * app; Ctrl then belongs to the terminal (Ctrl+C, Ctrl+R, Ctrl+_ in claude).
 */
export const IS_MAC = /Mac/i.test(globalThis.navigator?.platform ?? '')

export type ShortcutAction =
  | { type: 'newPane' }
  | { type: 'closePane' }
  | { type: 'toggleZoom' }
  | { type: 'focus'; dir: Direction }
  | { type: 'workspace'; index: number }
  | { type: 'shortcuts' }
  | { type: 'palette' }
  | { type: 'diff' }
  /** +1 / -1 steps the terminal font size; 0 resets it. */
  | { type: 'fontSize'; delta: -1 | 0 | 1 }

export interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

const ARROWS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down'
}

/**
 * Maps a keydown to an app action, or null when the key belongs to the terminal.
 * Uses `code` for Ctrl+Shift combos because Shift changes `key` ('!' for 1, '?' for /).
 * `mac` swaps Ctrl for Cmd; the other of the two must not be held.
 */
export function matchShortcut(e: KeyLike, mac = IS_MAC): ShortcutAction | null {
  const mod = mac ? e.metaKey : e.ctrlKey
  if (mac ? e.ctrlKey : e.metaKey) return null
  if (mod && e.altKey && !e.shiftKey) {
    const dir = ARROWS[e.key]
    return dir ? { type: 'focus', dir } : null
  }
  // Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0, like a browser. Ctrl+Shift+- stays with the
  // terminal: it is claude's undo (Ctrl+_).
  if (mod && !e.altKey) {
    if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+')
      return { type: 'fontSize', delta: 1 }
    if (!e.shiftKey && (e.code === 'Minus' || e.code === 'NumpadSubtract'))
      return { type: 'fontSize', delta: -1 }
    if (!e.shiftKey && (e.code === 'Digit0' || e.code === 'Numpad0'))
      return { type: 'fontSize', delta: 0 }
  }
  if (mod && e.shiftKey && !e.altKey) {
    switch (e.code) {
      case 'KeyN':
        return { type: 'newPane' }
      case 'KeyW':
        return { type: 'closePane' }
      case 'KeyZ':
        return { type: 'toggleZoom' }
      case 'Slash':
        return { type: 'shortcuts' }
      case 'KeyP':
        return { type: 'palette' }
      case 'KeyD':
        return { type: 'diff' }
    }
    const digit = /^Digit([1-9])$/.exec(e.code)
    if (digit) return { type: 'workspace', index: Number(digit[1]) - 1 }
  }
  return null
}

/** How a chord is written on this platform: "Ctrl+Shift+N", or "⌘⇧N" on macOS. */
export function chord(keys: ('mod' | 'shift' | 'alt' | string)[], mac = IS_MAC): string {
  const glyph: Record<string, string> = mac
    ? { mod: '⌘', shift: '⇧', alt: '⌥' }
    : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' }
  const parts = keys.map((k) => glyph[k] ?? k)
  return mac ? parts.join('') : parts.join('+')
}

/** The keys of a chord, one per <kbd>: ["Ctrl", "Shift", "N"] or ["⌘", "⇧", "N"]. */
export function chordKeys(keys: string[], mac = IS_MAC): string[] {
  const glyph: Record<string, string> = mac
    ? { mod: '⌘', shift: '⇧', alt: '⌥' }
    : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt' }
  return keys.map((k) => glyph[k] ?? k)
}

export const SHORTCUT_HINT = {
  newPane: chord(['mod', 'shift', 'N']),
  closePane: chord(['mod', 'shift', 'W']),
  zoom: chord(['mod', 'shift', 'Z']),
  focus: chord(['mod', 'alt', 'Arrow']),
  workspace: chord(['mod', 'shift', '1…9']),
  shortcuts: chord(['mod', 'shift', '/']),
  palette: chord(['mod', 'shift', 'P']),
  diff: chord(['mod', 'shift', 'D']),
  fontSize: IS_MAC ? '⌘= / ⌘- / ⌘0' : 'Ctrl+= / Ctrl+- / Ctrl+0',
  /** Ctrl+Shift+3 or ⌘⇧3: switch to workspace n. */
  workspaceN: (n: number) => chord(['mod', 'shift', String(n)])
} as const
