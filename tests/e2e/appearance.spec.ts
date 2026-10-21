import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')

test('themes, accent and terminal colors apply live and persist; themes import and delete', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-appearance-e2e-'))
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(userData, { recursive: true })
  const configFile = path.join(userData, 'config.json')
  const saved = () => JSON.parse(fs.readFileSync(configFile, 'utf8')).settings
  const themesDir = path.join(tmp, '.wraithgrid', 'themes')
  fs.mkdirSync(themesDir, { recursive: true })
  fs.writeFileSync(path.join(themesDir, 'broken.json'), '{ not json')
  const ocean = path.join(tmp, 'ocean-theme.json')
  fs.writeFileSync(
    ocean,
    JSON.stringify({
      name: 'Ocean',
      mode: 'dark',
      colors: { bg: '#0f1a24', text: '#e6f1ff', accent: '#38bdf8' }
    })
  )

  const app = await electron.launch({
    args: [MAIN],
    cwd: tmp,
    env: { ...process.env, HOME: tmp, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    const root = win.locator('html')
    const cssVar = (name: string) =>
      win.evaluate(
        (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
        name
      )
    await win.getByRole('button', { name: 'More' }).click()
    await win.getByRole('menuitem', { name: 'Settings' }).click()
    await win.getByRole('tab', { name: 'Appearance' }).click()

    const themes = win.getByRole('radiogroup', { name: 'Theme' })
    for (const name of ['Wraith', 'Midnight', 'Clay', 'Daylight', 'Paper'])
      await expect(themes.getByRole('radio', { name })).toBeVisible()
    await expect(themes.getByRole('radio', { name: 'Wraith' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    // A bad file in the themes folder is reported, not applied.
    await expect(win.getByRole('status').filter({ hasText: 'broken.json' })).toBeVisible()

    await themes.getByRole('radio', { name: 'Paper' }).click()
    await expect(root).toHaveAttribute('data-theme', 'light')
    expect(await cssVar('--bg')).toBe('#fbf8f1')
    await themes.getByRole('radio', { name: 'Midnight' }).click()
    await expect(root).toHaveAttribute('data-theme', 'dark')
    expect(await cssVar('--acc')).toBe('#22d3ee')

    // Following the OS draws the dark pick (Midnight) or the light pick (Paper).
    await win.emulateMedia({ colorScheme: 'light' })
    await win.getByRole('switch', { name: /Follow the OS/ }).click()
    await expect(root).toHaveAttribute('data-theme', 'light')
    await expect.poll(() => cssVar('--bg')).toBe('#fbf8f1')
    await win.emulateMedia({ colorScheme: 'dark' })
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect.poll(() => cssVar('--bg')).toBe('#0f1420')

    await win
      .getByRole('radiogroup', { name: 'Accent color' })
      .getByRole('radio', { name: 'amber' })
      .click()
    await expect(root).toHaveAttribute('data-accent', 'amber')
    expect(await cssVar('--acc')).toBe('#f59e0b')

    await win
      .getByRole('radiogroup', { name: 'Terminal colors' })
      .getByRole('radio', { name: /Nord/ })
      .click()
    expect(
      await win.evaluate(() => document.documentElement.style.getPropertyValue('--term-bg'))
    ).toBe('#2e3440')

    await expect
      .poll(() => (fs.existsSync(configFile) ? saved() : null))
      .toMatchObject({
        theme: 'system',
        themeDark: 'midnight',
        themeLight: 'paper',
        accent: 'amber',
        terminalPalette: 'nord'
      })

    // Import: the file is checked, saved to ~/.wraithgrid/themes and drawn at once.
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as never
    }, ocean)
    await win.getByRole('button', { name: 'Import theme…' }).click()
    const oceanCard = themes.getByRole('radio', { name: 'Ocean' })
    await expect(oceanCard).toHaveAttribute('aria-checked', 'true')
    await expect(oceanCard).toContainText('yours')
    expect(fs.existsSync(path.join(themesDir, 'ocean.json'))).toBe(true)
    expect(await cssVar('--bg')).toBe('#0f1a24')
    expect(await cssVar('--acc')).toBe('#38bdf8')

    // Delete takes two clicks; the dark mode falls back to Wraith.
    await oceanCard.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Delete theme' }).click()
    await win.getByRole('menuitem', { name: 'Click again to delete' }).click()
    await expect(oceanCard).toHaveCount(0)
    expect(fs.existsSync(path.join(themesDir, 'ocean.json'))).toBe(false)
    await expect(themes.getByRole('radio', { name: 'Wraith' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(await cssVar('--bg')).toBe('#1c1c1c')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
