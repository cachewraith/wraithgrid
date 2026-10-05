import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parseIcon } from '@shared/icons'
import { bodies, trimMaterial } from '../../scripts/icon-sets'
import {
  STARTER_ICONS,
  iconBody,
  searchIcons,
  type IconSets
} from '../../src/renderer/lib/icon-search'

const require = createRequire(import.meta.url)
const real: IconSets = {
  material: trimMaterial(require('@iconify-json/material-symbols/icons.json')),
  lucide: bodies(require('@iconify-json/lucide/icons.json'))
}

describe('parseIcon', () => {
  it('tells letters, emoji and bundled icons apart', () => {
    expect(parseIcon('')).toEqual({ kind: 'letter' })
    expect(parseIcon('🦊')).toEqual({ kind: 'emoji', text: '🦊' })
    expect(parseIcon('material:rocket-launch')).toEqual({
      kind: 'glyph',
      set: 'material',
      name: 'rocket-launch'
    })
    expect(parseIcon('lucide:git-branch')).toMatchObject({ kind: 'glyph', set: 'lucide' })
  })

  it('treats anything else, including markup, as text', () => {
    for (const v of ['mdi:home', 'material:<svg>', 'lucide:__proto__', 'material:', '<b>x</b>'])
      expect(parseIcon(v).kind).toBe('emoji')
  })
})

describe('bundled icon data', () => {
  it('keeps one Material style per icon, rounded where there is one', () => {
    const n = Object.keys(real.material).length
    expect(n).toBeGreaterThan(3000)
    expect(n).toBeLessThan(5000)
    expect(Object.keys(real.material).some((k) => /-(rounded|sharp|outline)$/.test(k))).toBe(false)
    const raw = require('@iconify-json/material-symbols/icons.json')
    expect(real.material.home).toBe(raw.icons['home-rounded'].body)
    expect(Object.keys(real.lucide).length).toBeGreaterThan(1500)
  })

  it('has every starter icon', () => {
    for (const h of STARTER_ICONS) expect(iconBody(real, h.set, h.name), h.name).not.toBeNull()
  })

  it('never looks up inherited keys', () => {
    expect(iconBody(real, 'material', 'constructor')).toBeNull()
    expect(iconBody(real, 'lucide', '__proto__')).toBeNull()
  })
})

describe('searchIcons', () => {
  it('ranks an exact name first, then prefixes, then the rest', () => {
    const hits = searchIcons(real, 'rocket', null)
    // Both sets have a "rocket"; those come before "rocket-launch" and the like.
    expect(hits.slice(0, 2).map((h) => h.name)).toEqual(['rocket', 'rocket'])
    expect(hits[2]!.name.startsWith('rocket')).toBe(true)
    expect(hits.every((h) => h.name.includes('rocket'))).toBe(true)
  })

  it('needs every word, filters by set, and caps the list', () => {
    expect(searchIcons(real, 'git branch', 'lucide').map((h) => h.name)).toContain('git-branch')
    expect(searchIcons(real, 'home', 'material').every((h) => h.set === 'material')).toBe(true)
    expect(searchIcons(real, 'a', null, 50)).toHaveLength(50)
    expect(searchIcons(real, 'zzqqxx', null)).toEqual([])
  })

  it('shows the starter set for an empty query', () => {
    expect(searchIcons(real, '  ', null)).toEqual(STARTER_ICONS)
    expect(searchIcons(real, '', 'lucide').every((h) => h.set === 'lucide')).toBe(true)
  })
})
