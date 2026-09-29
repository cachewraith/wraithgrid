import { describe, expect, it } from 'vitest'
import { ACCENTS, TERMINAL_PALETTES, resolveTheme } from '@shared/types'
import { PALETTE_LABEL, TERMINAL_THEMES, terminalTheme } from '../../src/renderer/lib/term-theme'

describe('resolveTheme', () => {
  it('follows the OS only for system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})

describe('terminalTheme', () => {
  it('returns the same object for the same inputs', () => {
    expect(terminalTheme('match', 'dark', 'teal')).toBe(terminalTheme('match', 'dark', 'teal'))
    expect(terminalTheme('nord', 'dark', 'teal')).toBe(terminalTheme('nord', 'light', 'rose'))
  })

  it('keeps the violet match palette identical to the original theme colors', () => {
    for (const theme of ['dark', 'light'] as const) {
      const t = terminalTheme('match', theme, 'violet')
      expect(t.cursor).toBe(TERMINAL_THEMES[theme].cursor)
      expect(t.background).toBe(TERMINAL_THEMES[theme].background)
      expect(t.red).toBe(TERMINAL_THEMES[theme].red)
    }
  })

  it('tints only cursor and selection with the accent', () => {
    const violet = terminalTheme('match', 'dark', 'violet')
    const amber = terminalTheme('match', 'dark', 'amber')
    expect(amber.cursor).not.toBe(violet.cursor)
    expect(amber.selectionBackground).not.toBe(violet.selectionBackground)
    expect({
      ...amber,
      cursor: 0,
      selectionBackground: 0,
      scrollbarSliderActiveBackground: 0
    }).toEqual({
      ...violet,
      cursor: 0,
      selectionBackground: 0,
      scrollbarSliderActiveBackground: 0
    })
  })

  it('defines all 16 ANSI colors and a label for every palette', () => {
    const keys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
    for (const p of TERMINAL_PALETTES) {
      expect(PALETTE_LABEL[p]).toBeTruthy()
      for (const accent of ACCENTS) {
        const t = terminalTheme(p, 'dark', accent)
        for (const k of keys) {
          const bright = `bright${k[0]!.toUpperCase()}${k.slice(1)}` as keyof typeof t
          expect(t[k as keyof typeof t], `${p} ${k}`).toMatch(/^#[0-9a-f]{6}$/)
          expect(t[bright], `${p} ${bright}`).toMatch(/^#[0-9a-f]{6}$/)
        }
      }
    }
  })
})
