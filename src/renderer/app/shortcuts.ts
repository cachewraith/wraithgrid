import type { Direction } from '../layout/focus'

export type ShortcutAction =
  | { type: 'newPane' }
  | { type: 'closePane' }
  | { type: 'toggleZoom' }
  | { type: 'focus'; dir: Direction }
  | { type: 'workspace'; index: number }
  | { type: 'shortcuts' }

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
 */
export function matchShortcut(e: KeyLike): ShortcutAction | null {
  if (e.metaKey) return null
  if (e.ctrlKey && e.altKey && !e.shiftKey) {
    const dir = ARROWS[e.key]
    return dir ? { type: 'focus', dir } : null
  }
  if (e.ctrlKey && e.shiftKey && !e.altKey) {
    switch (e.code) {
      case 'KeyN':
        return { type: 'newPane' }
      case 'KeyW':
        return { type: 'closePane' }
      case 'KeyZ':
        return { type: 'toggleZoom' }
      case 'Slash':
        return { type: 'shortcuts' }
    }
    const digit = /^Digit([1-9])$/.exec(e.code)
    if (digit) return { type: 'workspace', index: Number(digit[1]) - 1 }
  }
  return null
}

export const SHORTCUT_HINT = {
  newPane: 'Ctrl+Shift+N',
  closePane: 'Ctrl+Shift+W',
  zoom: 'Ctrl+Shift+Z',
  focus: 'Ctrl+Alt+Arrow',
  workspace: 'Ctrl+Shift+1…9',
  shortcuts: 'Ctrl+Shift+/'
} as const
