import { describe, expect, it } from 'vitest'
import { ACCENTS, TERMINAL_PALETTES, UI_ZOOM_STEPS, resolveTheme, stepZoom } from '@shared/types'
import { BUILT_IN_THEMES, withAccent } from '@shared/themes'
import { PALETTE_LABEL, terminalTheme } from '../../src/renderer/lib/term-theme'

const wraith = BUILT_IN_THEMES.find((t) => t.id === 'wraith')!

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
    expect(terminalTheme('match', wraith)).toBe(terminalTheme('match', wraith))
    const daylight = BUILT_IN_THEMES.find((t) => t.id === 'daylight')!
    expect(terminalTheme('nord', wraith)).toBe(terminalTheme('nord', daylight))
  })

  it('match uses the theme’s own terminal colors', () => {
    for (const theme of BUILT_IN_THEMES) {
      const t = terminalTheme('match', theme)
      expect(t.background).toBe(theme.terminal!.background)
      expect(t.cursor).toBe(theme.terminal!.cursor)
      expect(t.red).toBe(theme.terminal!.red)
    }
  })

  it('an accent tints only cursor and selection', () => {
    const own = terminalTheme('match', wraith)
    const amber = terminalTheme('match', withAccent(wraith, 'amber'))
    expect(amber.cursor).not.toBe(own.cursor)
    expect(amber.selectionBackground).not.toBe(own.selectionBackground)
    const strip = (t: object) => ({
      ...t,
      cursor: 0,
      selectionBackground: 0,
      scrollbarSliderActiveBackground: 0
    })
    expect(strip(amber)).toEqual(strip(own))
  })

  it('defines all 16 ANSI colors and a label for every palette', () => {
    const keys = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
    for (const p of TERMINAL_PALETTES) {
      expect(PALETTE_LABEL[p]).toBeTruthy()
      for (const theme of BUILT_IN_THEMES) {
        for (const accent of ACCENTS) {
          const t = terminalTheme(p, withAccent(theme, accent))
          for (const k of keys) {
            const bright = `bright${k[0]!.toUpperCase()}${k.slice(1)}` as keyof typeof t
            expect(t[k as keyof typeof t], `${p} ${k}`).toMatch(/^#[0-9a-f]{6}$/)
            expect(t[bright], `${p} ${bright}`).toMatch(/^#[0-9a-f]{6}$/)
          }
        }
      }
    }
  })
})

describe('stepZoom', () => {
  it('steps like a browser and stops at both ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(1.25, 0)).toBe(1)
    expect(stepZoom(2, 1)).toBe(2)
    expect(stepZoom(0.67, -1)).toBe(0.67)
    // A value between steps goes to the next one in that direction.
    expect(stepZoom(1.2, 1)).toBe(1.25)
    expect(stepZoom(1.2, -1)).toBe(1.1)
    expect(UI_ZOOM_STEPS).toContain(stepZoom(1.33, -1))
  })
})
