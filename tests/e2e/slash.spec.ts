import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')

test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('typing / lists the chat’s commands; picking one inserts or runs it', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-slash-'))
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
    const box = win.getByRole('combobox', { name: 'Message' })
    const menu = win.getByRole('listbox', { name: 'Commands' })
    // The commands arrive with the CLI's initialize answer.
    await expect(win.getByRole('button', { name: /^Model:/ })).toBeVisible()

    // ---- A bare / lists everything, grouped; ours first.
    await box.fill('/')
    await expect(menu).toBeVisible()
    await expect(box).toHaveAttribute('aria-expanded', 'true')
    await expect(menu.locator('.slash-hd').first()).toHaveText('Wraithgrid')
    await expect(menu.getByRole('option').first()).toContainText('/new')
    await expect(menu.getByRole('option', { name: /\/clear/ })).toHaveCount(0)

    // ---- Typing narrows it; ↓ and Enter pick; a skill is inserted for its arguments.
    await box.pressSequentially('postman')
    await expect(menu.getByRole('option')).toHaveCount(2)
    await expect(menu.getByRole('option').first()).toContainText('postman:api-mocking')
    await box.press('ArrowDown')
    await expect(menu.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
    await box.press('Enter')
    await expect(box).toHaveValue('/postman:api-testing ')
    await expect(menu).toHaveCount(0)
    await box.pressSequentially('check login')
    await box.press('Enter')
    // Sent as typed; the bubble shows the command as a chip.
    await expect(win.locator('.cmsg.user .cmd-chip')).toHaveText('/postman:api-testing')
    await expect(win.locator('.cmsg.agent').first()).toContainText(
      'Hello from fake claude: /postman:api-testing check login'
    )

    // ---- Esc closes the menu and keeps the text.
    await box.fill('/comp')
    await expect(menu.getByRole('option').first()).toContainText('/compact')
    await box.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(box).toHaveValue('/comp')

    // ---- Ours run at once: /usage opens the panel, /model the model list.
    await box.fill('/usa')
    await box.press('Enter')
    await expect(win.getByRole('heading', { name: 'Usage', level: 1 })).toBeVisible()
    await win.locator('.u-pill').click()
    await expect(box).toHaveValue('')
    await box.fill('/model')
    await box.press('Tab')
    await expect(win.getByRole('option', { name: /Sonnet 5\.5/ })).toBeVisible()
    await win.keyboard.press('Escape')

    // ---- A terminal-only command switches the pane to the CLI's own screen.
    await box.fill('/doc')
    await expect(menu.getByRole('option').first()).toContainText('terminal')
    await box.press('Enter')
    await expect(win.getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
