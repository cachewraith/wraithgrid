import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BUILT_IN_THEMES,
  THEME_COLOR_VARS,
  parseThemeFile,
  pickTheme,
  themeSlug,
  themeTerminal,
  themeVars,
  withAccent
} from '@shared/themes'
import { parseConfig } from '@shared/schema'
import { defaultConfig } from '@shared/schema'
import { deleteTheme, importTheme, listThemes, saveTheme } from '../../src/main/themes'

const minimal = {
  name: 'Ocean',
  mode: 'dark',
  colors: { bg: '#0f1a24', text: '#E6F1FF', accent: '#38bdf8' }
}

describe('built-in themes', () => {
  it('are five, with every color and all terminal colors set', () => {
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual([
      'wraith',
      'midnight',
      'clay',
      'daylight',
      'paper'
    ])
    for (const t of BUILT_IN_THEMES) {
      expect(parseThemeFile(t).ok, t.id).toBe(true)
      for (const k of Object.keys(THEME_COLOR_VARS))
        expect(t.colors, `${t.id} ${k}`).toHaveProperty(k)
      expect(Object.keys(t.terminal!)).toHaveLength(20)
    }
  })
})

describe('parseThemeFile', () => {
  it('accepts three colors and normalizes hex', () => {
    const r = parseThemeFile(minimal)
    expect(r.ok && r.theme.colors.text).toBe('#e6f1ff')
    expect(parseThemeFile({ ...minimal, colors: { ...minimal.colors, ok: '#0f0' } })).toMatchObject(
      {
        ok: true,
        theme: { colors: { ok: '#00ff00' } }
      }
    )
  })

  it('refuses anything that is not a hex color, so no CSS gets in', () => {
    for (const bad of [
      'red',
      'rgb(0,0,0)',
      '#000; background: url(https://x)',
      'var(--bg)',
      '#12345',
      'expression(alert(1))'
    ]) {
      const r = parseThemeFile({ ...minimal, colors: { ...minimal.colors, bg: bad } })
      expect(r.ok, bad).toBe(false)
    }
  })

  it('names the problem: missing colors, unknown keys, bad mode or name', () => {
    expect(parseThemeFile({ ...minimal, colors: { bg: '#000000' } })).toMatchObject({
      ok: false,
      error: expect.stringContaining('colors.text')
    })
    expect(parseThemeFile({ ...minimal, colors: { ...minimal.colors, bgg: '#000' } }).ok).toBe(
      false
    )
    expect(parseThemeFile({ ...minimal, mode: 'dim' }).ok).toBe(false)
    expect(parseThemeFile({ ...minimal, name: '<script>' }).ok).toBe(false)
    expect(parseThemeFile({ ...minimal, terminal: { red: 'blue' } }).ok).toBe(false)
  })
})

describe('themeVars and themeTerminal', () => {
  it('fills every token for a three-color theme, from its own colors', () => {
    const r = parseThemeFile(minimal)
    if (!r.ok) throw new Error(r.error)
    const v = themeVars(r.theme)
    for (const cssVar of Object.values(THEME_COLOR_VARS)) expect(v[cssVar], cssVar).toBeTruthy()
    expect(v['--bg']).toBe('#0f1a24')
    expect(v['--line']).toContain('var(--bg)')
    const term = themeTerminal(r.theme)
    expect(term.background).toBe('#0f1a24')
    expect(term.cursor).toBe('#38bdf8')
  })

  it('an accent replaces the accent colors only', () => {
    const w = BUILT_IN_THEMES[0]!
    const amber = withAccent(w, 'amber')
    expect(amber.colors.accent).toBe('#f59e0b')
    expect(amber.colors.bg).toBe(w.colors.bg)
    expect(withAccent(w, 'theme')).toBe(w)
  })

  it('pickTheme falls back to the mode default when the id is gone or the wrong mode', () => {
    expect(pickTheme(BUILT_IN_THEMES, 'clay', 'dark').id).toBe('clay')
    expect(pickTheme(BUILT_IN_THEMES, 'gone', 'dark').id).toBe('wraith')
    expect(pickTheme(BUILT_IN_THEMES, 'paper', 'dark').id).toBe('wraith')
    expect(pickTheme(BUILT_IN_THEMES, 'gone', 'light').id).toBe('daylight')
  })

  it('slugs names into file ids', () => {
    expect(themeSlug('My Ocean!')).toBe('my-ocean')
    expect(themeSlug('…')).toBe('theme')
  })
})

describe('settings', () => {
  it('old configs keep their mode and get the default themes', () => {
    const raw = JSON.parse(JSON.stringify(defaultConfig()))
    raw.settings = { theme: 'light', accent: 'teal' }
    const r = parseConfig(raw)
    expect(r.ok && r.config.settings).toMatchObject({
      theme: 'light',
      themeDark: 'wraith',
      themeLight: 'daylight',
      accent: 'teal'
    })
    raw.settings = { themeDark: '../etc', accent: 'theme' }
    const r2 = parseConfig(raw)
    expect(r2.ok && r2.config.settings.themeDark).toBe('wraith')
  })
})

describe('themes folder', () => {
  let dir: string
  let src: string
  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-themes-'))
    dir = path.join(tmp, 'themes')
    src = path.join(tmp, 'src')
    fs.mkdirSync(src)
  })
  afterEach(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }))

  it('imports a valid file under a free id and lists it', async () => {
    const f = path.join(src, 'whatever.json')
    fs.writeFileSync(f, JSON.stringify({ ...minimal, extra: 'dropped' }))
    expect(await importTheme(f, dir)).toEqual({ ok: true, id: 'ocean' })
    expect(await importTheme(f, dir)).toEqual({ ok: true, id: 'ocean-2' })
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'ocean.json'), 'utf8'))
    expect(saved).not.toHaveProperty('extra')
    const list = await listThemes(dir)
    expect(list.themes.map((t) => t.id)).toEqual(['ocean', 'ocean-2'])
    expect(list.themes[0]).toMatchObject({ builtIn: false, colors: { text: '#e6f1ff' } })
  })

  it('refuses bad files on import and reports them in the list', async () => {
    const f = path.join(src, 'bad.json')
    fs.writeFileSync(f, JSON.stringify({ ...minimal, colors: { ...minimal.colors, bg: 'url(x)' } }))
    expect(await importTheme(f, dir)).toMatchObject({
      ok: false,
      error: expect.stringContaining('colors.bg')
    })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'broken.json'), '{nope')
    fs.writeFileSync(path.join(dir, 'wraith.json'), JSON.stringify(minimal))
    fs.writeFileSync(path.join(dir, 'Bad Name.json'), JSON.stringify(minimal))
    const list = await listThemes(dir)
    expect(list.themes).toEqual([])
    expect(list.problems.map((p) => p.file).sort()).toEqual([
      'Bad Name.json',
      'broken.json',
      'wraith.json'
    ])
  })

  it('a missing folder lists nothing', async () => {
    expect(await listThemes(dir)).toEqual({ themes: [], problems: [] })
  })

  it('deletes only its own theme files', async () => {
    const f = path.join(src, 'o.json')
    fs.writeFileSync(f, JSON.stringify(minimal))
    await importTheme(f, dir)
    expect(await deleteTheme('wraith', dir)).toBe(false)
    expect(await deleteTheme('../x', dir)).toBe(false)
    expect(await deleteTheme('ocean', dir)).toBe(true)
    expect(fs.existsSync(path.join(dir, 'ocean.json'))).toBe(false)
  })

  it('saves the editor theme after checking it, under a free id', async () => {
    const theme = { ...minimal, style: { radius: 'large' } }
    expect(await saveTheme(theme, dir)).toEqual({ ok: true, id: 'ocean' })
    expect(await saveTheme(theme, dir)).toEqual({ ok: true, id: 'ocean-2' })
    const r = await listThemes(dir)
    expect(r.themes.map((t) => t.style?.radius)).toEqual(['large', 'large'])
    const bad = await saveTheme({ ...minimal, style: { radius: 'huge' } }, dir)
    expect(bad.ok).toBe(false)
    expect((await listThemes(dir)).themes).toHaveLength(2)
  })
})

describe('theme style (#24)', () => {
  const base = {
    name: 'Mine',
    mode: 'dark',
    colors: { bg: '#101010', text: '#eeeeee', accent: '#ff8800' }
  }

  it('takes the style keys and the new chat colors', () => {
    const r = parseThemeFile({
      ...base,
      colors: { ...base.colors, userBubble: '#223344', codeBlock: '#0a0a0a', diffAdd: '#00ff0022' },
      style: {
        font: 'Inter',
        monoFont: 'Fira Code',
        chatTextSize: 16,
        radius: 'large',
        border: 'thick',
        depth: 'deep',
        density: 'compact',
        motion: 'reduced',
        frameGradient: true
      }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const v = themeVars(r.theme)
    expect(v['--font-ui']).toContain("'Inter'")
    expect(v['--font-mono']).toContain("'Fira Code'")
    expect(v['--chat-size']).toBe('16px')
    expect(v['--rs']).toBe('1.6')
    expect(v['--bw']).toBe('1.5px')
    expect(v['--dens']).toBe('0.85')
    expect(v['--frame-img']).toContain('radial-gradient')
    expect(v['--user-bg']).toBe('#223344')
    expect(v['--addbg']).toBe('#00ff0022')
  })

  it('refuses values outside the fixed options, and raw CSS', () => {
    for (const style of [
      { radius: 'huge' },
      { font: 'Comic Sans MS' },
      { chatTextSize: 30 },
      { motion: 'wild' },
      { css: 'body { display: none }' },
      { font: "Geist'; } body { x: y" }
    ]) {
      const r = parseThemeFile({ ...base, style })
      expect(r.ok, JSON.stringify(style)).toBe(false)
    }
    expect(parseThemeFile({ ...base, colors: { ...base.colors, userBubble: 'red' } }).ok).toBe(
      false
    )
  })

  it('an old file without a style keeps loading, with the default look', () => {
    const r = parseThemeFile(base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.theme.style).toBeUndefined()
    const v = themeVars(r.theme)
    expect(v['--rs']).toBe('1.2')
    expect(v['--font-ui']).toContain("'Geist'")
    expect(v['--frame-img']).toBe('none')
    expect(v['--user-bg']).toContain('color-mix')
  })

  it('an accent override re-tints the user bubble', () => {
    const t = withAccent(BUILT_IN_THEMES[0]!, 'blue')
    expect(t.colors.userBubble).toBeUndefined()
    expect(themeVars(t)['--user-bg']).toContain('var(--acc)')
  })

  it('the built-ins differ in style, not only color, and all validate', () => {
    const looks = new Set(BUILT_IN_THEMES.map((t) => JSON.stringify(t.style)))
    expect(looks.size).toBeGreaterThanOrEqual(4)
    for (const t of BUILT_IN_THEMES) {
      const { id: _id, builtIn: _b, ...file } = t
      expect(parseThemeFile(file).ok, t.id).toBe(true)
    }
  })
})
