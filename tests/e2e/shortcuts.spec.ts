import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

test('a shortcut rebound in Settings works at once, is refused when taken, and persists', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-shortcuts-e2e-'))
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(userData, { recursive: true })
  const configFile = path.join(userData, 'config.json')
  const saved = () => {
    try {
      return JSON.parse(fs.readFileSync(configFile, 'utf8')).settings.shortcuts
    } catch {
      return null
    }
  }

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: tmp, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    await win.getByRole('button', { name: 'Settings' }).click()

    // A chord another action has is refused with its name.
    await win.getByRole('button', { name: 'Change shortcut: Search panes and commands' }).click()
    await expect(win.getByText('Press the new keys…')).toBeVisible()
    await win.keyboard.press(`${MOD}+Shift+KeyN`)
    await expect(win.getByText('Already used by New pane.')).toBeVisible()

    // Recording takes the chord: it does not open the palette meanwhile.
    await win.getByRole('button', { name: 'Change shortcut: Search panes and commands' }).click()
    await win.keyboard.press(`${MOD}+Alt+KeyK`)
    await expect(win.getByRole('textbox', { name: 'Search' })).toHaveCount(0)
    await expect.poll(saved).toEqual({ palette: 'mod+alt+KeyK' })

    // The old chord is free again; the new one opens the palette.
    await win.keyboard.press(`${MOD}+Shift+KeyP`)
    await expect(win.getByRole('textbox', { name: 'Search' })).toHaveCount(0)
    await win.keyboard.press(`${MOD}+Alt+KeyK`)
    await expect(win.getByRole('textbox', { name: 'Search' })).toBeFocused()
    await win.keyboard.press('Escape')

    await win.getByRole('button', { name: 'Reset shortcut: Search panes and commands' }).click()
    await expect.poll(saved).toEqual({})
    await win.keyboard.press(`${MOD}+Shift+KeyP`)
    await expect(win.getByRole('textbox', { name: 'Search' })).toBeFocused()
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
