import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

// The theme editor (#24): live on the whole app, contrast warnings with a fix, undo, save.
const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')

test('theme editor: live edits, contrast fix, undo, cancel, save as a new theme', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-ted-'))
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(userData, { recursive: true })
  const app = await electron.launch({
    args: [MAIN],
    cwd: tmp,
    env: { ...process.env, HOME: tmp, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    const cssVar = (name: string) =>
      win.evaluate(
        (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
        name
      )
    await win.getByRole('button', { name: 'More' }).click()
    await win.getByRole('menuitem', { name: 'Settings' }).click()
    await win.getByRole('tab', { name: 'Appearance' }).click()
    await win.getByRole('button', { name: 'Customize…' }).click()
    const ed = win.getByRole('region', { name: 'Theme editor' })
    await expect(ed.getByLabel('Theme name')).toHaveValue('Wraith custom')

    // A color: the whole app follows at once.
    await ed.getByLabel('Accent hex', { exact: true }).fill('#ff8800')
    await expect.poll(() => cssVar('--acc')).toBe('#ff8800')
    await expect(ed).toContainText('1 change')

    // Style: corners and motion.
    await ed
      .getByRole('radiogroup', { name: 'Corners' })
      .getByRole('radio', { name: 'Large' })
      .click()
    await expect.poll(() => cssVar('--rs')).toBe('1.4')
    await ed.getByRole('radiogroup', { name: 'Motion' }).getByRole('radio', { name: 'Off' }).click()
    await expect(win.locator('html')).toHaveAttribute('data-motion', 'off')

    // Hard-to-read hints: warned, and one click fixes them.
    await ed.getByLabel('Hints hex', { exact: true }).fill('#202020')
    const warn = ed.getByRole('status', { name: 'Contrast warnings' })
    await expect(warn).toContainText('Hints and timestamps on the background')
    await warn.getByRole('button', { name: /^Use #/ }).click()
    await expect(warn).toHaveCount(0)

    // Undo steps back; Cancel puts the chosen theme back.
    await ed.getByRole('button', { name: 'Undo' }).click()
    await expect(warn).toBeVisible()
    await ed.getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(() => cssVar('--acc')).toBe('#7c5cff')
    await expect(win.locator('html')).toHaveAttribute('data-motion', 'on')

    // Save as a new theme: written to the themes folder, listed, and in use.
    await win.getByRole('button', { name: 'Customize…' }).click()
    await ed.getByLabel('Theme name').fill('Sunset')
    await ed.getByLabel('Accent hex', { exact: true }).fill('#ff5500')
    await ed.getByRole('radiogroup', { name: 'Depth' }).getByRole('radio', { name: 'Deep' }).click()
    await ed.getByRole('button', { name: 'Save as new theme' }).click()
    await expect(ed).toHaveCount(0)
    const themes = win.getByRole('radiogroup', { name: 'Theme' })
    await expect(themes.getByRole('radio', { name: 'Sunset' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(await cssVar('--acc')).toBe('#ff5500')
    const file = JSON.parse(
      fs.readFileSync(path.join(tmp, '.wraithgrid/themes/sunset.json'), 'utf8')
    )
    expect(file).toMatchObject({ name: 'Sunset', mode: 'dark', style: { depth: 'deep' } })
    expect(file.colors.accent).toBe('#ff5500')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
