import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

// The README screenshots, from a staged demo: `bun run build`, then
// `WRAITHGRID_README_SHOTS=docs/screenshots ./node_modules/.bin/playwright test readme-shots`.
const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const DEMO_CLAUDE = path.join(ROOT, 'tests/fixtures/demo-claude.sh')
const OUT = process.env.WRAITHGRID_README_SHOTS

test.skip(!OUT || process.platform === 'win32', 'set WRAITHGRID_README_SHOTS=<dir> (POSIX only)')

const account = (id: string, name: string, color: string, icon: string, extra = {}) => ({
  id,
  name,
  configDir: `~/.wraithgrid/accounts/${name}`,
  color,
  signedIn: true,
  imported: false,
  icon,
  folderId: null,
  ...extra
})
const pane = (id: string, accountId: string, folder: string) => ({
  id,
  accountId,
  cwd: `~/code/${folder}`,
  title: folder
})
const row = (a: string, b: string) => ({
  type: 'split',
  dir: 'row',
  sizes: [50, 50],
  children: [
    { type: 'pane', paneId: a },
    { type: 'pane', paneId: b }
  ]
})

test('README screenshots', async () => {
  const out = path.resolve(OUT!)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-shots-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  for (const f of ['api-server', 'web-app', 'infra', 'mobile'])
    fs.mkdirSync(path.join(home, 'code', f), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: DEMO_CLAUDE,
      accountFolders: [{ id: 'f-work', name: 'Work', collapsed: false, icon: '', color: '' }],
      accounts: [
        account('a-work', 'work', '#2dd4bf', '💼', { folderId: 'f-work' }),
        account('a-acme', 'client-acme', '#f59e0b', '', { folderId: 'f-work' }),
        account('a-personal', 'personal', '#f97316', '🦊'),
        account('a-oss', 'oss', '#ef4444', '🐙', { signedIn: false })
      ],
      workspaces: [
        {
          id: 'ws-main',
          name: 'main',
          icon: 'material:rocket-launch',
          color: '#8b5cf6',
          panes: [
            pane('p-api', 'a-work', 'api-server'),
            pane('p-web', 'a-personal', 'web-app'),
            pane('p-infra', 'a-acme', 'infra'),
            pane('p-mobile', 'a-personal', 'mobile')
          ],
          layout: {
            type: 'split',
            dir: 'col',
            sizes: [50, 50],
            children: [row('p-api', 'p-web'), row('p-infra', 'p-mobile')]
          }
        },
        {
          id: 'ws-side',
          name: 'side-projects',
          icon: 'lucide:flask-conical',
          color: '#3b82f6',
          panes: [],
          layout: null
        }
      ],
      activeWorkspace: 'ws-main',
      recentFolders: ['~/code/api-server', '~/code/web-app'],
      settings: { sharedMode: 'overall', checkUpdatesOnLaunch: false, theme: 'dark' }
    })
  )
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    await win.setViewportSize({ width: 1908, height: 1023 })
    const shot = (name: string) => win.screenshot({ path: path.join(out, name) })
    const pane = (title: string) =>
      win.locator('section.pane', { has: win.locator('.ph-title', { hasText: title }) })

    // Every session has drawn, one is working and one waits for approval.
    await expect(pane('mobile').locator('.xterm-rows')).toContainText('11 tests')
    await expect(pane('web-app').locator('.xterm-rows')).toContainText('first paint.')
    await expect(pane('infra')).toContainText('needs approval')
    await expect(pane('api-server')).toContainText('running')
    await expect(pane('web-app')).toContainText('idle', {
      timeout: 15_000
    })
    await expect(pane('mobile')).toContainText('idle', {
      timeout: 15_000
    })
    await pane('api-server').locator('.xterm-screen').click()
    await win.waitForTimeout(800)
    await shot('grid-dark.png')

    await win.keyboard.press('Control+Shift+N')
    await win.getByRole('button', { name: /^Folder / }).click()
    const picker = win.getByRole('group', { name: 'Choose a folder' })
    await picker.getByLabel('Filter folders or type a path').fill('~/code/api-server')
    await picker.getByLabel('Filter folders or type a path').press('Control+Enter')
    await expect(picker).toHaveCount(0)
    await win.waitForTimeout(300)
    await shot('new-pane.png')
    await win.keyboard.press('Escape')

    const side = win.getByRole('complementary', { name: 'Sidebar' })
    await side.getByRole('button', { name: /Switch account/ }).click()
    await win.getByRole('menuitem', { name: 'Manage accounts' }).click()
    await expect(win.getByRole('button', { name: 'Change the icon of work' })).toBeVisible()
    await win.waitForTimeout(300)
    await shot('accounts.png')

    await win.getByRole('button', { name: 'More' }).click()

    await win.getByRole('menuitem', { name: 'Settings' }).click()
    await win.getByRole('radio', { name: 'teal' }).click()
    await win
      .getByText('Appearance', { exact: true })
      .evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await win.waitForTimeout(300)
    await shot('settings.png')

    await win.getByRole('radio', { name: 'Light', exact: true }).click()
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'light')
    await side.locator('.ws-row', { hasText: 'main' }).click()
    await win.getByRole('button', { name: /Open chats/ }).click()
    await expect(pane('api-server')).toBeVisible()
    await pane('api-server').locator('.xterm-screen').click()
    await win.waitForTimeout(800)
    await shot('grid-light.png')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
