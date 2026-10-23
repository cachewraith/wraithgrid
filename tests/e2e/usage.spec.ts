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

test("usage: the pill follows the focused chat's account and names it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-usage2-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  const account = (id: string, name: string) => ({
    id,
    name,
    configDir: `~/.wraithgrid/accounts/${name}`,
    color: '#7c5cff',
    signedIn: true,
    imported: false
  })
  fs.writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: FAKE_CLAUDE,
      accounts: [account('a-work', 'work'), account('a-home', 'home')],
      workspaces: [
        {
          id: 'ws-main',
          name: 'main',
          panes: [
            { id: 'p-work', accountId: 'a-work', cwd: '~/proj', title: 'w', view: 'chat' },
            { id: 'p-home', accountId: 'a-home', cwd: '~/proj', title: 'h', view: 'chat' }
          ],
          layout: null
        }
      ],
      activeWorkspace: 'ws-main',
      recentFolders: [],
      settings: { defaultAccountId: 'a-work', checkUpdatesOnLaunch: false }
    })
  )
  // The default account (work) already has a limit from earlier; home has none yet.
  const later = Date.now() + 3 * 3_600_000
  fs.writeFileSync(
    path.join(userData, 'usage.json'),
    JSON.stringify({
      buckets: [],
      limits: {
        'a-work': {
          fiveHour: { utilization: 0.13, resetsAt: later },
          sevenDay: { utilization: 0.2, resetsAt: later },
          at: Date.now()
        }
      }
    })
  )
  const app = await electron.launch({
    args: [MAIN],
    cwd: tmp,
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    const pill = win.locator('.u-pill')
    const homePane = win.getByRole('region', { name: /^h pane, account home/ })
    const workPane = win.getByRole('region', { name: /^w pane, account work/ })

    // Focusing home's chat: its own (unknown) limit, never work's.
    await homePane.getByLabel('Message', { exact: true }).click()
    await expect(pill).toHaveText('home·–')
    await expect(pill).toHaveAttribute(
      'aria-label',
      'Usage: no limits from home yet (they show after its first chat turn)'
    )

    // A turn as home reports home's limit (the fake claude says 42%).
    const composer = homePane.getByLabel('Message', { exact: true })
    await composer.fill('hello')
    // Two chats start at once: Enter only sends once this one is ready.
    await expect(homePane.getByRole('button', { name: 'Send (Enter)' })).toBeEnabled()
    await composer.press('Enter')
    await expect(homePane.locator('.cmsg.agent').first()).toContainText('Hello from fake claude')
    await expect(pill).toHaveText('home·42%')
    await expect(pill).toHaveAttribute(
      'aria-label',
      'Usage: home: 42% of the current session limit (the focused chat’s account)'
    )

    // Focusing work's chat switches to work's limit; so does the sidebar row.
    await workPane.getByLabel('Message', { exact: true }).click()
    await expect(pill).toHaveText('work·13%')
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    await expect(side.getByRole('button', { name: /^Usage/ })).toContainText('work · 13%')
    // A long name stays on one line, cut with an ellipsis; the % stays whole (#64).
    const fit = await side.getByRole('button', { name: /^Usage/ }).evaluate((live) => {
      // Measured on a copy beside it, so React's own nodes are left alone.
      const row = live.cloneNode(true) as HTMLElement
      live.after(row)
      const nm = row.querySelector<HTMLElement>('.nav-pct-nm')!
      nm.textContent = 'a-very-long-account-name-for-testing · '
      const n = row.querySelector<HTMLElement>('.nav-pct-n')!
      const r = {
        sameHeight: row.getBoundingClientRect().height === live.getBoundingClientRect().height,
        cut: nm.scrollWidth > nm.clientWidth,
        pctWhole: n.scrollWidth <= n.clientWidth,
        pctInside: n.getBoundingClientRect().right <= row.getBoundingClientRect().right
      }
      row.remove()
      return r
    })
    expect(fit).toEqual({ sameHeight: true, cut: true, pctWhole: true, pctInside: true })

    // The account menu says who new chats use and which accounts have open panes (#49).
    await side.getByRole('button', { name: /Switch account/ }).click()
    const menu = win.getByRole('menu', { name: 'Accounts' })
    await expect(menu).toContainText('New chats use')
    await expect(menu.getByRole('menuitemradio', { name: /^home/ })).toContainText('1 pane open')
    await expect(menu.getByRole('menuitemradio', { name: /^work/ })).toContainText('1 pane open')
    await win.keyboard.press('Escape')
    // Usage lists the accounts in use with their pane counts.
    await win.locator('.u-pill').click()
    await expect(win.getByRole('group', { name: 'Account home' })).toContainText('1 pane open')
    await expect(win.getByRole('group', { name: 'Account work' })).toContainText('1 pane open')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
