import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')

test('accounts drag into sidebar folders; accounts and workspaces take a custom icon', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-folders-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  const cfgFile = path.join(userData, 'config.json')
  fs.writeFileSync(
    cfgFile,
    JSON.stringify({
      version: 1,
      claudePath: '',
      accounts: [
        {
          id: 'a-work',
          name: 'work',
          configDir: '~/.wraithgrid/accounts/work',
          color: '#2dd4bf',
          signedIn: true,
          imported: false
        }
      ],
      workspaces: [{ id: 'ws', name: 'main', panes: [], layout: null }],
      activeWorkspace: 'ws',
      recentFolders: [],
      settings: { sharedMode: 'per-account' }
    })
  )
  const saved = () => JSON.parse(fs.readFileSync(cfgFile, 'utf8'))

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    await side.getByRole('button', { name: 'New folder' }).click()
    const folder = side.locator('.fold', { hasText: 'Folder 1' })
    await expect(folder).toBeVisible()

    // Drag the account row onto the folder.
    await win.waitForTimeout(500)
    const row = side.locator('.acc-row', { hasText: 'work' })
    const from = (await row.boundingBox())!
    const to = (await folder.locator('.fold-hd').boundingBox())!
    await win.mouse.move(from.x + 20, from.y + from.height / 2)
    await win.mouse.down()
    await win.waitForTimeout(100)
    await win.mouse.move(from.x + 30, from.y + from.height / 2, { steps: 3 })
    for (let i = 1; i <= 8; i++) {
      await win.mouse.move(from.x + 30 + (10 * i) / 8, from.y + ((to.y - from.y) * i) / 8)
      await win.waitForTimeout(30)
    }
    await win.mouse.move(to.x + 40, to.y + to.height / 2)
    await win.waitForTimeout(100)
    await win.mouse.up()
    await expect(folder.locator('.acc-row', { hasText: 'work' })).toBeVisible()
    await expect.poll(() => saved().accounts[0].folderId).toBe(saved().accountFolders[0]?.id)

    // Pick an icon on the Accounts page.
    await side.getByRole('button', { name: 'Manage' }).last().click()
    await win.getByRole('button', { name: 'Change the icon of work' }).click()
    await win.getByRole('button', { name: 'Use 🦊' }).click()
    await expect.poll(() => saved().accounts[0].icon).toBe('🦊')
    await expect(side.locator('.avatar', { hasText: '🦊' })).toBeVisible()

    // Workspaces take an icon too, from the switcher.
    await side.getByRole('button', { name: 'Manage' }).first().click()
    await win.getByRole('button', { name: 'Change the icon of main' }).click()
    await win.getByRole('button', { name: 'Use 🚀' }).click()
    await expect.poll(() => saved().workspaces[0].icon).toBe('🚀')
    await win.keyboard.press('Escape')
    await expect(side.locator('.ws-row .avatar', { hasText: '🚀' })).toBeVisible()
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
