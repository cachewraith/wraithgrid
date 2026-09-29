import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')

test('theme, accent and terminal colors apply live and persist', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-appearance-e2e-'))
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(userData, { recursive: true })
  const configFile = path.join(userData, 'config.json')
  const saved = () => JSON.parse(fs.readFileSync(configFile, 'utf8')).settings

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: tmp, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    const root = win.locator('html')
    await win.getByRole('button', { name: 'Settings' }).click()

    const theme = win.getByRole('radiogroup', { name: 'Theme' })
    await theme.getByRole('radio', { name: 'Light' }).click()
    await expect(root).toHaveAttribute('data-theme', 'light')

    // System follows the OS setting as it changes.
    await win.emulateMedia({ colorScheme: 'dark' })
    await theme.getByRole('radio', { name: 'System' }).click()
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await win.emulateMedia({ colorScheme: 'light' })
    await expect(root).toHaveAttribute('data-theme', 'light')

    await win
      .getByRole('radiogroup', { name: 'Accent color' })
      .getByRole('radio', { name: 'amber' })
      .click()
    await expect(root).toHaveAttribute('data-accent', 'amber')
    const acc = await win.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()
    )
    expect(acc).toBe('#f59e0b')

    await win
      .getByRole('radiogroup', { name: 'Terminal colors' })
      .getByRole('radio', { name: /Nord/ })
      .click()
    const termBg = await win.evaluate(() =>
      document.documentElement.style.getPropertyValue('--term-bg')
    )
    expect(termBg).toBe('#2e3440')

    // Unpackaged builds skip the launch check, so nothing has been fetched.
    await expect(win.getByText('Not checked yet.')).toBeVisible()
    await win.getByRole('switch', { name: 'Check when Wraithgrid starts' }).click()

    await expect
      .poll(() => (fs.existsSync(configFile) ? saved() : null))
      .toMatchObject({
        theme: 'system',
        accent: 'amber',
        terminalPalette: 'nord',
        checkUpdatesOnLaunch: false
      })
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
