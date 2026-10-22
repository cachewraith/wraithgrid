import { describe, expect, it } from 'vitest'
import { contrastIssues, contrastRatio, passingColor } from '@shared/contrast'
import { BUILT_IN_THEMES } from '@shared/themes'

describe('contrast (#24 theme editor)', () => {
  it('measures WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('finds a nearby color that passes', () => {
    const fix = passingColor('#7a6f64', '#1f1b18', 4.5)
    expect(contrastRatio(fix, '#1f1b18')).toBeGreaterThanOrEqual(4.5)
    expect(
      contrastRatio(passingColor('#cccccc', '#ffffff', 4.5), '#ffffff')
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('flags only the theme’s own pairs that fall short, with a fix', () => {
    const t = {
      name: 'x',
      mode: 'dark' as const,
      colors: { bg: '#1f1b18', text: '#f0e9e1', accent: '#d97757', faint: '#3a332d' }
    }
    const issues = contrastIssues(t)
    expect(issues.map((i) => i.fg)).toEqual(['faint'])
    expect(contrastRatio(issues[0]!.fix, '#1f1b18')).toBeGreaterThanOrEqual(4.5)
  })

  it('the built-ins pass for body text', () => {
    for (const t of BUILT_IN_THEMES)
      expect(
        contrastIssues(t).filter((i) => i.fg === 'text'),
        t.id
      ).toEqual([])
  })
})
