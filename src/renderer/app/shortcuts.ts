import { SHORTCUT_IDS, type ShortcutId } from '@shared/types'
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
  /** +1 / -1 zooms the whole app a step; 0 resets it to 100%. */
  | { type: 'uiZoom'; delta: -1 | 0 | 1 }

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

/** A rebindable chord: always the app modifier, plus Shift and/or Alt, on a key code. */
export interface Binding {
  shift: boolean
  alt: boolean
  code: string
}

const DEFAULT_BINDINGS: Record<ShortcutId, Binding> = {
  newPane: { shift: true, alt: false, code: 'KeyN' },
  closePane: { shift: true, alt: false, code: 'KeyW' },
  toggleZoom: { shift: true, alt: false, code: 'KeyZ' },
  palette: { shift: true, alt: false, code: 'KeyP' },
  diff: { shift: true, alt: false, code: 'KeyD' },
  shortcuts: { shift: true, alt: false, code: 'Slash' }
}

/** `mod+shift+KeyN`, as saved in settings. */
export function formatBinding(b: Binding): string {
  return ['mod', b.shift ? 'shift' : '', b.alt ? 'alt' : '', b.code].filter(Boolean).join('+')
}

export function parseBinding(raw: string): Binding | null {
  const m = /^mod\+(shift\+)?(alt\+)?([A-Za-z0-9]{1,24})$/.exec(raw)
  return m ? { shift: !!m[1], alt: !!m[2], code: m[3]! } : null
}

/** The bindings in effect: defaults, with the user's valid ones on top. */
let bindings: Record<ShortcutId, Binding> = { ...DEFAULT_BINDINGS }

export function setShortcutBindings(saved: Partial<Record<ShortcutId, string>>): void {
  const next = { ...DEFAULT_BINDINGS }
  for (const id of SHORTCUT_IDS) {
    const b = saved[id] ? parseBinding(saved[id]!) : null
    if (b && !bindingProblem(b, id, next)) next[id] = b
  }
  bindings = next
}

/** While Settings records a new chord, no key is an app shortcut. */
let recording = false
export function setRecordingShortcut(on: boolean): void {
  recording = on
}

export function currentBinding(id: ShortcutId): Binding {
  return bindings[id]
}

export function defaultBinding(id: ShortcutId): Binding {
  return DEFAULT_BINDINGS[id]
}

/** The binding a keydown asks for while recording one, or null for a lone modifier. */
export function bindingFromEvent(e: KeyLike, mac = IS_MAC): Binding | null {
  if (!(mac ? e.metaKey : e.ctrlKey) || (mac ? e.ctrlKey : e.metaKey)) return null
  if (
    !/^(?:Key[A-Z]|Digit\d|F\d{1,2}|Slash|Backslash|Period|Comma|Semicolon|Quote|BracketLeft|BracketRight|Backquote)$/.test(
      e.code
    )
  )
    return null
  return { shift: e.shiftKey, alt: e.altKey, code: e.code }
}

/**
 * Why a binding can't be used, or null when it can. Without Shift or Alt it would take a
 * key the terminal needs (Ctrl+C, Ctrl+R…); fixed chords and other bindings can't be shared.
 */
export function bindingProblem(
  b: Binding,
  id: ShortcutId,
  all: Record<ShortcutId, Binding> = bindings
): string | null {
  if (!b.shift && !b.alt) return 'Add Shift or Alt: the plain chord belongs to the terminal.'
  if (b.alt && !b.shift && /^Arrow/.test(b.code)) return 'Reserved for moving focus.'
  if (b.shift && !b.alt && /^Digit[1-9]$/.test(b.code)) return 'Reserved for switching workspaces.'
  if (b.shift && b.code === 'Minus') return "Reserved for claude's undo."
  if (b.shift && b.code === 'KeyC') return 'Reserved for copy.'
  if (b.shift && b.code === 'KeyV') return 'Reserved for paste.'
  const taken = SHORTCUT_IDS.find(
    (other) =>
      other !== id &&
      all[other].code === b.code &&
      all[other].shift === b.shift &&
      all[other].alt === b.alt
  )
  return taken ? `Already used by ${SHORTCUT_LABEL[taken]}.` : null
}

export const SHORTCUT_LABEL: Record<ShortcutId, string> = {
  newPane: 'New pane',
  closePane: 'Close pane',
  toggleZoom: 'Zoom pane / back to grid',
  palette: 'Search panes and commands',
  diff: 'Show / hide the git diff',
  shortcuts: 'Show the shortcuts sheet'
}

/** What a key code shows as: KeyN → N, Digit3 → 3, Slash → /. */
function keyName(code: string): string {
  const named: Record<string, string> = {
    Slash: '/',
    Backslash: '\\',
    Period: '.',
    Comma: ',',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`'
  }
  return named[code] ?? code.replace(/^(?:Key|Digit)/, '')
}

/** The keys of a binding, one per <kbd>. */
export function bindingKeys(b: Binding, mac = IS_MAC): string[] {
  return chordKeys(
    ['mod', ...(b.shift ? ['shift'] : []), ...(b.alt ? ['alt'] : []), keyName(b.code)],
    mac
  )
}

export function bindingHint(b: Binding, mac = IS_MAC): string {
  return chord(
    ['mod', ...(b.shift ? ['shift'] : []), ...(b.alt ? ['alt'] : []), keyName(b.code)],
    mac
  )
}

const sameKey = (e: KeyLike, b: Binding): boolean =>
  e.code === b.code && e.shiftKey === b.shift && e.altKey === b.alt

/**
 * Maps a keydown to an app action, or null when the key belongs to the terminal.
 * Uses `code` for Ctrl+Shift combos because Shift changes `key` ('!' for 1, '?' for /).
 * `mac` swaps Ctrl for Cmd; the other of the two must not be held.
 */
export function matchShortcut(e: KeyLike, mac = IS_MAC): ShortcutAction | null {
  const mod = mac ? e.metaKey : e.ctrlKey
  if (recording || (mac ? e.ctrlKey : e.metaKey)) return null
  if (mod) {
    const id = SHORTCUT_IDS.find((x) => sameKey(e, bindings[x]))
    if (id) return { type: id }
  }
  if (mod && e.altKey && !e.shiftKey) {
    const dir = ARROWS[e.key]
    return dir ? { type: 'focus', dir } : null
  }
  // Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 zoom the app, like a browser. Ctrl+Shift+- stays with the
  // terminal: it is claude's undo (Ctrl+_).
  if (mod && !e.altKey) {
    if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+')
      return { type: 'uiZoom', delta: 1 }
    if (!e.shiftKey && (e.code === 'Minus' || e.code === 'NumpadSubtract'))
      return { type: 'uiZoom', delta: -1 }
    if (!e.shiftKey && (e.code === 'Digit0' || e.code === 'Numpad0'))
      return { type: 'uiZoom', delta: 0 }
  }
  if (mod && e.shiftKey && !e.altKey) {
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

/** Read when drawn, so a rebound shortcut shows its new keys. */
export const SHORTCUT_HINT = {
  get newPane() {
    return bindingHint(bindings.newPane)
  },
  get closePane() {
    return bindingHint(bindings.closePane)
  },
  get zoom() {
    return bindingHint(bindings.toggleZoom)
  },
  focus: chord(['mod', 'alt', 'Arrow']),
  workspace: chord(['mod', 'shift', '1…9']),
  get shortcuts() {
    return bindingHint(bindings.shortcuts)
  },
  get palette() {
    return bindingHint(bindings.palette)
  },
  get diff() {
    return bindingHint(bindings.diff)
  },
  fontSize: IS_MAC ? '⌘= / ⌘- / ⌘0' : 'Ctrl+= / Ctrl+- / Ctrl+0',
  /** Ctrl+Shift+3 or ⌘⇧3: switch to workspace n. */
  workspaceN: (n: number) => chord(['mod', 'shift', String(n)])
}
