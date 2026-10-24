import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')

test('project icons: suggested from the folder, picked, searched and removed (#80)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-icons-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(path.join(home, 'shop'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(
    path.join(home, 'shop', 'composer.json'),
    '{"require":{"laravel/framework":"^11.0"}}'
  )
  const cfgFile = path.join(userData, 'config.json')
  fs.writeFileSync(
    cfgFile,
    JSON.stringify({
      version: 1,
      claudePath: '',
      accounts: [],
      workspaces: [
        { id: 'ws-shop', name: 'shop', folder: '~/shop', icon: '🚀', panes: [], layout: null }
      ],
      activeWorkspace: 'ws-shop',
      recentFolders: [],
      settings: { checkUpdatesOnLaunch: false }
    })
  )
  const icon = (): string => JSON.parse(fs.readFileSync(cfgFile, 'utf8')).workspaces[0].icon

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    const row = side.locator('.ws-row', { hasText: 'shop' })
    // An old emoji icon draws the folder icon.
    await expect(row.locator('svg.pj-icon')).toHaveCount(1)

    await row.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Change icon' }).click()
    const dlg = win.getByRole('dialog', { name: 'Icon for shop' })
    await expect(
      dlg.getByLabel('Suggested icons').getByRole('button', { name: 'laravel' })
    ).toBeVisible()
    await dlg.getByLabel('Suggested icons').getByRole('button', { name: 'laravel' }).click()
    await expect(dlg).toHaveCount(0)
    await expect.poll(icon).toBe('mit:laravel')

    // Search, keyboard into the grid, Enter picks.
    await row.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Change icon' }).click()
    await dlg.getByLabel('Search icons').fill('spring')
    await dlg.getByLabel('Search icons').press('ArrowDown')
    await win.keyboard.press('Enter')
    await expect.poll(icon).toBe('dev:spring')

    // General tab, then Remove icon.
    await row.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Change icon' }).click()
    await dlg.getByRole('tab', { name: 'General' }).click()
    await dlg.getByRole('button', { name: 'desktop windows' }).click()
    await expect.poll(icon).toBe('ms:desktop-windows')
    await row.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Change icon' }).click()
    await dlg.getByRole('button', { name: 'Remove icon' }).click()
    await expect.poll(icon).toBe('')
  } finally {
    await app.close()
  }
})
