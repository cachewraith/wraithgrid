import { afterEach, describe, expect, it } from 'vitest'
import {
  SHORTCUT_HINT,
  bindingFromEvent,
  bindingProblem,
  chord,
  chordKeys,
  matchShortcut,
  parseBinding,
  setShortcutBindings,
  type KeyLike
} from '../../src/renderer/app/shortcuts'

const key = (k: Partial<KeyLike>): KeyLike => ({
  key: '',
  code: '',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...k
})
const ctrlShift = (code: string, k = ''): KeyLike =>
  key({ code, key: k, ctrlKey: true, shiftKey: true })

/** Linux/Windows bindings; macOS is tested on its own below. */
const match = (k: KeyLike) => matchShortcut(k, false)

describe('matchShortcut', () => {
  it('maps the default bindings', () => {
    expect(match(ctrlShift('KeyN', 'N'))).toEqual({ type: 'newPane' })
    expect(match(ctrlShift('KeyW', 'W'))).toEqual({ type: 'closePane' })
    expect(match(ctrlShift('KeyZ', 'Z'))).toEqual({ type: 'toggleZoom' })
    expect(match(ctrlShift('Slash', '?'))).toEqual({ type: 'shortcuts' })
    expect(match(ctrlShift('KeyP', 'P'))).toEqual({ type: 'palette' })
    expect(match(ctrlShift('KeyD', 'D'))).toEqual({ type: 'diff' })
  })

  it('maps Ctrl+Shift+1..9 to workspace indexes by physical key', () => {
    expect(match(ctrlShift('Digit1', '!'))).toEqual({ type: 'workspace', index: 0 })
    expect(match(ctrlShift('Digit9', '('))).toEqual({ type: 'workspace', index: 8 })
    expect(match(ctrlShift('Digit0', ')'))).toBeNull()
  })

  it('maps Ctrl+Alt+Arrow to focus moves', () => {
    const arrow = (k: string): KeyLike => key({ key: k, code: k, ctrlKey: true, altKey: true })
    expect(match(arrow('ArrowLeft'))).toEqual({ type: 'focus', dir: 'left' })
    expect(match(arrow('ArrowRight'))).toEqual({ type: 'focus', dir: 'right' })
    expect(match(arrow('ArrowUp'))).toEqual({ type: 'focus', dir: 'up' })
    expect(match(arrow('ArrowDown'))).toEqual({ type: 'focus', dir: 'down' })
  })

  it('leaves terminal keys alone', () => {
    expect(match(key({ key: 'c', code: 'KeyC', ctrlKey: true }))).toBeNull() // Ctrl+C
    expect(match(key({ key: 'ArrowUp', code: 'ArrowUp' }))).toBeNull()
    expect(match(key({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true }))).toBeNull()
    expect(match(ctrlShift('KeyC', 'C'))).toBeNull() // copy is handled by the terminal
    expect(match(ctrlShift('KeyV', 'V'))).toBeNull() // paste too
    expect(match(key({ key: 'Escape', code: 'Escape' }))).toBeNull()
    expect(match(key({ key: 'n', code: 'KeyN', ctrlKey: true }))).toBeNull()
  })

  it('ignores extra modifiers', () => {
    expect(match(key({ code: 'KeyN', ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull()
    expect(match(key({ code: 'KeyN', ctrlKey: true, shiftKey: true, metaKey: true }))).toBeNull()
    expect(match(key({ key: 'ArrowLeft', ctrlKey: true, altKey: true, shiftKey: true }))).toBeNull()
  })

  it('maps Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 to font size, leaving Ctrl+_ to the terminal', () => {
    const ctrl = (code: string, k: string, shiftKey = false): KeyLike =>
      key({ code, key: k, ctrlKey: true, shiftKey })
    expect(match(ctrl('Equal', '='))).toEqual({ type: 'fontSize', delta: 1 })
    expect(match(ctrl('Equal', '+', true))).toEqual({ type: 'fontSize', delta: 1 })
    expect(match(ctrl('NumpadAdd', '+'))).toEqual({ type: 'fontSize', delta: 1 })
    expect(match(ctrl('Minus', '-'))).toEqual({ type: 'fontSize', delta: -1 })
    expect(match(ctrl('Digit0', '0'))).toEqual({ type: 'fontSize', delta: 0 })
    expect(match(ctrl('Minus', '_', true))).toBeNull()
  })
})

describe('macOS bindings', () => {
  const cmd = (k: Partial<KeyLike>): KeyLike => key({ metaKey: true, ...k })

  it('uses Cmd where Linux and Windows use Ctrl', () => {
    expect(matchShortcut(cmd({ code: 'KeyN', shiftKey: true }), true)).toEqual({ type: 'newPane' })
    expect(matchShortcut(cmd({ code: 'KeyP', shiftKey: true }), true)).toEqual({ type: 'palette' })
    expect(matchShortcut(cmd({ code: 'Digit2', shiftKey: true }), true)).toEqual({
      type: 'workspace',
      index: 1
    })
    expect(matchShortcut(cmd({ code: 'Equal', key: '=' }), true)).toEqual({
      type: 'fontSize',
      delta: 1
    })
    expect(matchShortcut(cmd({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }), true)).toEqual(
      {
        type: 'focus',
        dir: 'left'
      }
    )
  })

  it('leaves every Ctrl chord to the terminal', () => {
    expect(matchShortcut(ctrlShift('KeyN', 'N'), true)).toBeNull()
    expect(matchShortcut(key({ code: 'Minus', ctrlKey: true, shiftKey: true }), true)).toBeNull()
    expect(matchShortcut(key({ code: 'Equal', ctrlKey: true }), true)).toBeNull()
    // Cmd+C / Cmd+V are copy and paste (the Edit menu), not app shortcuts.
    expect(matchShortcut(cmd({ code: 'KeyC', key: 'c' }), true)).toBeNull()
    expect(matchShortcut(cmd({ code: 'KeyV', key: 'v' }), true)).toBeNull()
  })

  it('writes hints the platform way', () => {
    expect(chord(['mod', 'shift', 'N'], true)).toBe('⌘⇧N')
    expect(chord(['mod', 'shift', 'N'], false)).toBe('Ctrl+Shift+N')
    expect(chordKeys(['mod', 'alt', '←'], true)).toEqual(['⌘', '⌥', '←'])
  })
})

describe('rebound shortcuts', () => {
  afterEach(() => setShortcutBindings({}))

  it('uses a saved binding instead of the default, and shows it in hints', () => {
    setShortcutBindings({ newPane: 'mod+alt+KeyT' })
    expect(match(ctrlShift('KeyN', 'N'))).toBeNull()
    expect(match(key({ code: 'KeyT', ctrlKey: true, altKey: true }))).toEqual({ type: 'newPane' })
    expect(SHORTCUT_HINT.newPane).toMatch(/Alt\+T$|⌥T$/)
  })

  it('ignores a saved binding that is invalid or taken', () => {
    setShortcutBindings({ newPane: 'mod+KeyC', closePane: 'mod+shift+KeyP' })
    expect(match(ctrlShift('KeyN', 'N'))).toEqual({ type: 'newPane' })
    expect(match(ctrlShift('KeyP', 'P'))).toEqual({ type: 'palette' })
  })

  it('records a chord with the app modifier and refuses ones the terminal needs', () => {
    expect(bindingFromEvent(key({ code: 'KeyK', ctrlKey: true, shiftKey: true }), false)).toEqual({
      shift: true,
      alt: false,
      code: 'KeyK'
    })
    expect(
      bindingFromEvent(key({ code: 'ShiftLeft', ctrlKey: true, shiftKey: true }), false)
    ).toBeNull()
    expect(bindingFromEvent(key({ code: 'KeyK', shiftKey: true }), false)).toBeNull()
    const b = (raw: string) => parseBinding(raw)!
    expect(bindingProblem(b('mod+KeyK'), 'newPane')).toMatch(/Shift or Alt/)
    expect(bindingProblem(b('mod+shift+Digit2'), 'newPane')).toMatch(/workspaces/)
    expect(bindingProblem(b('mod+shift+KeyC'), 'newPane')).toMatch(/copy/)
    expect(bindingProblem(b('mod+shift+KeyP'), 'newPane')).toMatch(/Search panes/)
    expect(bindingProblem(b('mod+shift+KeyK'), 'newPane')).toBeNull()
    expect(parseBinding('shift+KeyK')).toBeNull()
  })
})
