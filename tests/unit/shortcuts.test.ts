import { describe, expect, it } from 'vitest'
import { matchShortcut, type KeyLike } from '../../src/renderer/app/shortcuts'

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

describe('matchShortcut', () => {
  it('maps the default bindings', () => {
    expect(matchShortcut(ctrlShift('KeyN', 'N'))).toEqual({ type: 'newPane' })
    expect(matchShortcut(ctrlShift('KeyW', 'W'))).toEqual({ type: 'closePane' })
    expect(matchShortcut(ctrlShift('KeyZ', 'Z'))).toEqual({ type: 'toggleZoom' })
    expect(matchShortcut(ctrlShift('Slash', '?'))).toEqual({ type: 'shortcuts' })
    expect(matchShortcut(ctrlShift('KeyP', 'P'))).toEqual({ type: 'palette' })
    expect(matchShortcut(ctrlShift('KeyD', 'D'))).toEqual({ type: 'diff' })
  })

  it('maps Ctrl+Shift+1..9 to workspace indexes by physical key', () => {
    expect(matchShortcut(ctrlShift('Digit1', '!'))).toEqual({ type: 'workspace', index: 0 })
    expect(matchShortcut(ctrlShift('Digit9', '('))).toEqual({ type: 'workspace', index: 8 })
    expect(matchShortcut(ctrlShift('Digit0', ')'))).toBeNull()
  })

  it('maps Ctrl+Alt+Arrow to focus moves', () => {
    const arrow = (k: string): KeyLike => key({ key: k, code: k, ctrlKey: true, altKey: true })
    expect(matchShortcut(arrow('ArrowLeft'))).toEqual({ type: 'focus', dir: 'left' })
    expect(matchShortcut(arrow('ArrowRight'))).toEqual({ type: 'focus', dir: 'right' })
    expect(matchShortcut(arrow('ArrowUp'))).toEqual({ type: 'focus', dir: 'up' })
    expect(matchShortcut(arrow('ArrowDown'))).toEqual({ type: 'focus', dir: 'down' })
  })

  it('leaves terminal keys alone', () => {
    expect(matchShortcut(key({ key: 'c', code: 'KeyC', ctrlKey: true }))).toBeNull() // Ctrl+C
    expect(matchShortcut(key({ key: 'ArrowUp', code: 'ArrowUp' }))).toBeNull()
    expect(matchShortcut(key({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true }))).toBeNull()
    expect(matchShortcut(ctrlShift('KeyC', 'C'))).toBeNull() // copy is handled by the terminal
    expect(matchShortcut(ctrlShift('KeyV', 'V'))).toBeNull() // paste too
    expect(matchShortcut(key({ key: 'Escape', code: 'Escape' }))).toBeNull()
    expect(matchShortcut(key({ key: 'n', code: 'KeyN', ctrlKey: true }))).toBeNull()
  })

  it('ignores extra modifiers', () => {
    expect(
      matchShortcut(key({ code: 'KeyN', ctrlKey: true, shiftKey: true, altKey: true }))
    ).toBeNull()
    expect(
      matchShortcut(key({ code: 'KeyN', ctrlKey: true, shiftKey: true, metaKey: true }))
    ).toBeNull()
    expect(
      matchShortcut(key({ key: 'ArrowLeft', ctrlKey: true, altKey: true, shiftKey: true }))
    ).toBeNull()
  })

  it('maps Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 to font size, leaving Ctrl+_ to the terminal', () => {
    const ctrl = (code: string, k: string, shiftKey = false): KeyLike =>
      key({ code, key: k, ctrlKey: true, shiftKey })
    expect(matchShortcut(ctrl('Equal', '='))).toEqual({ type: 'fontSize', delta: 1 })
    expect(matchShortcut(ctrl('Equal', '+', true))).toEqual({ type: 'fontSize', delta: 1 })
    expect(matchShortcut(ctrl('NumpadAdd', '+'))).toEqual({ type: 'fontSize', delta: 1 })
    expect(matchShortcut(ctrl('Minus', '-'))).toEqual({ type: 'fontSize', delta: -1 })
    expect(matchShortcut(ctrl('Digit0', '0'))).toEqual({ type: 'fontSize', delta: 0 })
    expect(matchShortcut(ctrl('Minus', '_', true))).toBeNull()
  })
})
