import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')

test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('usage: limits from claude fill the button and panel; turns are recorded', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-usage-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(
    path.join(userData, 'config.json'),
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
      workspaces: [
        {
          id: 'ws-main',
          name: 'main',
          panes: [
            { id: 'p-chat', accountId: 'a-work', cwd: '~/proj', title: 'proj', view: 'chat' }
          ],
          layout: null
        }
      ],
      activeWorkspace: 'ws-main',
      recentFolders: [],
      settings: { defaultAccountId: 'a-work', checkUpdatesOnLaunch: false }
    })
  )
  const app = await electron.launch({
    args: [MAIN],
    cwd: tmp,
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    // Before any limit is known: the pill and the sidebar row just say Usage.
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    await expect(win.locator('.u-pill')).toHaveText('Usage')
    await expect(side.getByRole('button', { name: 'Usage', exact: true })).toBeVisible()

    const composer = win.getByLabel('Message', { exact: true })
    await composer.fill('count my tokens')
    await composer.press('Enter')
    await expect(win.locator('.cmsg.agent').first()).toContainText('Hello from fake claude')

    // The button reads the current session limit claude reported.
    const button = win.getByRole('button', { name: 'Usage: 42% of the current session limit' })
    await expect(button).toHaveText('42%')
    await button.click()

    const page = win.locator('.u-page')
    await expect(page.getByRole('heading', { name: 'Usage', level: 1 })).toBeVisible()
    const acct = page.getByRole('group', { name: 'Account work' })
    await expect(acct.getByRole('meter', { name: 'Current session' })).toHaveAttribute(
      'aria-valuenow',
      '42'
    )
    await expect(acct).toContainText(/Current session42%resets in 2h (9|10)m/)
    // Weekly at 75%: amber, with the day and time it resets.
    await expect(acct.locator('.ul-row.sev-warn')).toContainText('Weekly75%resets ')
    await expect(page.locator('.u-sum')).toContainText(
      '<$0.01 over 1 turn and 11K tokens in the last 7 days'
    )
    await expect(page.locator('.u-tbl').first()).toContainText('main111K<$0.01')
    await expect(page.locator('.u-tbl').nth(1)).toContainText('count my tokens')
    await expect(page.locator('.uc-col')).toHaveCount(7)

    await page.getByRole('radio', { name: '30 days' }).click()
    await expect(page.locator('.uc-col')).toHaveCount(30)
    await expect(page.locator('.u-sum')).toContainText('in the last 30 days')
    // The button toggles back to the chats.
    await button.click()
    await expect(page).toHaveCount(0)
    // The sidebar row shows the limit too, and the account menu leads there as well.
    const row = side.getByRole('button', { name: /^Usage/ })
    await expect(row).toContainText('42%')
    await row.click()
    await expect(page).toBeVisible()
    await expect(row).toHaveAttribute('aria-current', 'page')
    await win.locator('.u-pill').click()
    await side.getByRole('button', { name: /Switch account/ }).click()
    await win.getByRole('menuitem', { name: 'Usage' }).click()
    await expect(page).toBeVisible()

    // Saved in userData, so it is there after a restart.
    await expect
      .poll(() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(userData, 'usage.json'), 'utf8'))
        } catch {
          return null
        }
      })
      .toMatchObject({
        buckets: [{ accountId: 'a-work', workspaceId: 'ws-main', paneId: 'p-chat', turns: 1 }],
        limits: { 'a-work': { fiveHour: { utilization: 0.42 } } }
      })
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
