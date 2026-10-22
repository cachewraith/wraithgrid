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
const pane = (id: string, accountId: string, folder: string, extra = {}) => ({
  id,
  accountId,
  cwd: `~/code/${folder}`,
  title: folder,
  ...extra
})
const chat = (id: string, accountId: string, folder: string, title: string) =>
  pane(id, accountId, folder, { title, view: 'chat', hasConversation: true })
const row = (a: string, b: string) => ({
  type: 'split',
  dir: 'row',
  sizes: [50, 50],
  children: [
    { type: 'pane', paneId: a },
    { type: 'pane', paneId: b }
  ]
})

const DAY = 86_400_000
const localDay = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A month of chat spend over three accounts and two projects, and each account's limits. */
function demoUsage(now: number): unknown {
  const chats = [
    { accountId: 'a-work', workspaceId: 'ws-shop', paneId: 'h-auth', title: 'Rate-limit /login' },
    { accountId: 'a-work', workspaceId: 'ws-shop', paneId: 'c-orders', title: 'Fix slow /orders' },
    { accountId: 'a-personal', workspaceId: 'ws-shop', paneId: 'c-dark', title: 'Ship dark mode' },
    { accountId: 'a-acme', workspaceId: 'ws-agents', paneId: 'p-infra', title: 'infra' },
    { accountId: 'a-personal', workspaceId: 'ws-agents', paneId: 'p-mobile', title: 'mobile' }
  ]
  const buckets = []
  for (let d = 29; d >= 0; d--) {
    for (const [n, c] of chats.entries()) {
      // An uneven month: busier midweek, some chats rest on some days.
      const w = 0.25 + ((d * 7 + n * 5) % 11) / 12
      if ((d + n) % 4 === 0) continue
      const cost = Number((0.35 + w * (1.6 + n * 0.4)).toFixed(4))
      buckets.push({
        day: localDay(now - d * DAY),
        ...c,
        costUsd: cost,
        input: Math.round(cost * 900),
        output: Math.round(cost * 21_000),
        cacheRead: Math.round(cost * 520_000),
        cacheWrite: Math.round(cost * 40_000),
        turns: Math.max(1, Math.round(w * 14))
      })
    }
  }
  const win = (u: number, h: number) => ({ utilization: u, resetsAt: now + h * 3_600_000 })
  return {
    buckets,
    limits: {
      'a-work': { fiveHour: win(0.38, 2.5), sevenDay: win(0.61, 84), at: now },
      'a-personal': { fiveHour: win(0.86, 1.2), sevenDay: win(0.47, 60), at: now },
      'a-acme': { fiveHour: win(0.12, 4.1), sevenDay: win(0.29, 130), at: now }
    }
  }
}

test('README screenshots', async () => {
  const out = path.resolve(OUT!)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-shots-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  for (const f of ['api-server', 'web-app', 'infra', 'mobile'])
    fs.mkdirSync(path.join(home, 'code', f), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(out, { recursive: true })
  const now = Date.now()
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
          id: 'ws-shop',
          name: 'shop',
          icon: 'material:rocket-launch',
          color: '#8b5cf6',
          folder: '~/code/api-server',
          accountId: 'a-work',
          panes: [
            chat('c-orders', 'a-work', 'api-server', 'Fix slow /orders'),
            chat('c-dark', 'a-personal', 'web-app', 'Ship dark mode')
          ],
          layout: row('c-orders', 'c-dark'),
          history: [
            {
              pane: chat('h-auth', 'a-work', 'api-server', 'Rate-limit /login'),
              closedAt: now - 2 * 3_600_000
            },
            {
              pane: chat('h-flash', 'a-personal', 'web-app', 'Settings page flashes on load'),
              closedAt: now - DAY
            },
            {
              pane: chat('h-csv', 'a-work', 'api-server', 'Export orders as CSV'),
              closedAt: now - 3 * DAY
            },
            {
              pane: chat('h-deps', 'a-acme', 'api-server', 'Upgrade to Postgres 18'),
              closedAt: now - 6 * DAY
            }
          ]
        },
        {
          id: 'ws-agents',
          name: 'agents',
          icon: 'lucide:flask-conical',
          color: '#3b82f6',
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
        }
      ],
      activeWorkspace: 'ws-shop',
      recentFolders: ['~/code/api-server', '~/code/web-app'],
      settings: {
        sharedMode: 'overall',
        checkUpdatesOnLaunch: false,
        theme: 'dark',
        defaultAccountId: 'a-work'
      }
    })
  )
  fs.writeFileSync(path.join(userData, 'usage.json'), JSON.stringify(demoUsage(now)))
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
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    const ask = async (title: string, text: string) => {
      const box = pane(title).getByLabel('Message', { exact: true })
      await box.click()
      await box.fill(text)
      await box.press('Enter')
      await expect(box).toHaveValue('')
    }

    // Two chats side by side: one finished a fix, one waits for approval to push.
    await ask('Fix slow /orders', 'GET /orders times out with 200+ orders. Find out why and fix it')
    await expect(pane('Fix slow /orders')).toContainText('All 12 orders tests pass', {
      timeout: 15_000
    })
    await ask('Ship dark mode', 'Ship the dark mode toggle: run the tests, commit and push')
    await expect(
      pane('Ship dark mode').getByRole('button', { name: 'Allow', exact: true })
    ).toBeVisible()
    await pane('Ship dark mode').getByLabel('Message', { exact: true }).click()
    await win.waitForTimeout(800)
    await shot('chat-dark.png')

    // The project: open chats and History.
    await side.locator('.ws-row', { hasText: 'shop' }).click()
    await expect(win.getByRole('region', { name: 'History' })).toBeVisible()
    await win.waitForTimeout(300)
    await shot('project.png')

    // Usage: limits per account, spend per day, project and chat.
    await side
      .getByRole('button', { name: /^Usage/ })
      .first()
      .click()
    await expect(
      win.locator('.u-page').getByRole('heading', { name: 'Usage', level: 1 })
    ).toBeVisible()
    await win.locator('.u-page').getByText('30 days', { exact: true }).click()
    await win.locator('#u-spend-h').evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await win.waitForTimeout(500)
    await shot('usage.png')

    // Terminal panes still work as before: four claude sessions in a 2×2 grid.
    await win.keyboard.press('Control+Shift+2')
    await expect(pane('mobile').locator('.xterm-rows')).toContainText('11 tests')
    await expect(pane('web-app').locator('.xterm-rows')).toContainText('first paint.')
    await expect(pane('infra')).toContainText('needs approval')
    await expect(pane('api-server')).toContainText('running')
    await expect(pane('web-app')).toContainText('idle', { timeout: 15_000 })
    await expect(pane('mobile')).toContainText('idle', { timeout: 15_000 })
    await pane('api-server').locator('.xterm-screen').click()
    await win.waitForTimeout(800)
    await shot('grid-dark.png')

    await win.keyboard.press('Control+Shift+1')
    await win.keyboard.press('Control+Shift+N')
    await win.getByRole('button', { name: /^Folder / }).click()
    const picker = win.getByRole('group', { name: 'Choose a folder' })
    await picker.getByLabel('Filter folders or type a path').fill('~/code/api-server')
    await picker.getByLabel('Filter folders or type a path').press('Control+Enter')
    await expect(picker).toHaveCount(0)
    await win.waitForTimeout(300)
    await shot('new-pane.png')
    await win.keyboard.press('Escape')

    await side.getByRole('button', { name: /Switch account/ }).click()
    await win.getByRole('menuitem', { name: 'Manage accounts' }).click()
    await expect(win.getByRole('row', { name: /^work claude/ })).toBeVisible()
    await win.waitForTimeout(300)
    await shot('accounts.png')

    await win.getByRole('button', { name: 'More' }).click()
    await win.getByRole('menuitem', { name: 'Settings' }).click()
    await win.getByRole('tab', { name: 'Appearance' }).click()
    await win.getByRole('radio', { name: 'teal' }).click()
    // The demo's temp config path is noise in a README.
    await win
      .getByText(/^Saved to /)
      .evaluate((el) => ((el as HTMLElement).style.visibility = 'hidden'))
    await win.waitForTimeout(300)
    await shot('settings.png')

    await win.getByRole('radio', { name: 'Daylight', exact: true }).click()
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'light')
    await side.locator('.ws-row', { hasText: 'shop' }).click()
    await win.getByRole('button', { name: /Open chats/ }).click()
    await expect(pane('Fix slow /orders')).toBeVisible()
    await pane('Ship dark mode').getByLabel('Message', { exact: true }).click()
    await win.waitForTimeout(800)
    await shot('chat-light.png')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
