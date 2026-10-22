import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

// New project (#26): one screen creates a project with name, folder and account, and can
// open its first chat; the switcher only switches.
const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')

test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('New project: folder suggests the name, taken names refuse, the first chat opens', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-newproj-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(path.join(home, 'code/api'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  const cfgFile = path.join(userData, 'config.json')
  fs.writeFileSync(
    cfgFile,
    JSON.stringify({
      version: 1,
      claudePath: FAKE_CLAUDE,
      accounts: [
        {
          id: 'a-work',
          name: 'work',
          configDir: '~/.wraithgrid/accounts/work',
          color: '#7c5cff',
          signedIn: true,
          imported: false
        }
      ],
      workspaces: [{ id: 'ws-main', name: 'main', panes: [], layout: null }],
      activeWorkspace: 'ws-main',
      recentFolders: [],
      settings: { checkUpdatesOnLaunch: false }
    })
  )
  const saved = () => {
    try {
      return JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
    } catch {
      return null
    }
  }

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    await win.waitForSelector('.app .tb')
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    await side.getByRole('button', { name: 'New project', exact: true }).click()
    const dlg = win.getByRole('dialog', { name: 'New project' })
    await expect(dlg.getByLabel('Name')).toBeFocused()

    // Pick the folder in the app's own picker; the empty name takes the folder's.
    await dlg.getByRole('button', { name: /Choose a folder/ }).click()
    const picker = win.getByRole('group', { name: 'Choose a folder' })
    const input = picker.getByLabel('Filter folders or type a path')
    await input.fill('~/code/api')
    await input.press('Control+Enter')
    await expect(dlg.getByRole('button', { name: /^Folder api/ })).toBeVisible()
    await expect(dlg.getByLabel('Name')).toHaveValue('api')
    // The account is preselected; the first chat is the default start.
    await expect(dlg.getByRole('radio', { name: /work/ })).toBeChecked()
    await expect(dlg.getByRole('radio', { name: 'The first chat open' })).toBeChecked()

    // A taken name refuses with a message; a fresh one creates on Enter.
    await dlg.getByLabel('Name').fill('main')
    await dlg.getByRole('button', { name: 'Create project' }).click()
    await expect(dlg.getByRole('alert')).toContainText('A project named main exists.')
    await dlg.getByLabel('Name').fill('api')
    await dlg.getByLabel('Name').press('Enter')

    // The project exists, is active, and its first chat opened in its folder.
    await expect(dlg).toHaveCount(0)
    await expect(side.locator('.ws-row', { hasText: 'api' })).toBeVisible()
    await expect(win.locator('section.pane .chat-hello')).toBeVisible()
    await expect
      .poll(() => saved()?.workspaces?.[1] ?? null)
      .toMatchObject({ name: 'api', folder: '~/code/api', accountId: 'a-work' })
    expect(saved().workspaces[1].panes[0]).toMatchObject({ cwd: '~/code/api', accountId: 'a-work' })

    // The switcher only switches now; its footer hands off to New project.
    await win.keyboard.press('Control+Shift+P')
    await win.getByPlaceholder(/Search panes, projects/).fill('switch project')
    await win.getByRole('option', { name: /Switch project…/ }).click()
    const switcher = win.getByRole('dialog', { name: 'Switch project' })
    await expect(switcher.getByPlaceholder('Switch project…')).toBeVisible()
    await switcher.getByRole('button', { name: 'New project' }).click()
    await expect(win.getByRole('dialog', { name: 'New project' })).toBeVisible()
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
