import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')

test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('typing @ lists the project’s files; picking one inserts its path (#159)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-mention-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  for (const f of ['src/main/app.ts', 'src/main/ipc.ts', 'README.md', 'node_modules/dep/main.js']) {
    fs.mkdirSync(path.dirname(path.join(home, 'proj', f)), { recursive: true })
    fs.writeFileSync(path.join(home, 'proj', f), '')
  }
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
    const menu = win.getByRole('listbox', { name: 'Files' })
    await expect(win.getByRole('button', { name: /^Model:/ })).toBeVisible()

    // ---- A bare @ lists the top level, folders first; node_modules is never offered.
    await box.fill('@')
    await expect(menu.getByRole('option').first()).toHaveText('@src/')
    await expect(menu.getByRole('option', { name: '@README.md' })).toBeVisible()
    await expect(menu.getByRole('option', { name: /node_modules/ })).toHaveCount(0)

    // ---- A folder goes in without a space and opens it; a file ends the mention.
    await box.press('Enter')
    await expect(box).toHaveValue('@src/')
    await expect(menu.getByRole('option')).toHaveText(['@src/main/'])
    await box.press('Tab')
    await expect(box).toHaveValue('@src/main/')
    await expect(menu.getByRole('option')).toHaveText(['@src/main/app.ts', '@src/main/ipc.ts'])

    // ---- Typing filters by name anywhere in the text; the rest of the text is kept.
    await box.fill('explain @ip please')
    await box.press('End')
    for (let i = 0; i < ' please'.length; i++) await box.press('ArrowLeft')
    await expect(menu.getByRole('option').first()).toHaveText('@src/main/ipc.ts')
    await box.press('Enter')
    await expect(box).toHaveValue('explain @src/main/ipc.ts please')
    await expect(menu).toHaveCount(0)

    // ---- Esc closes it and keeps the text; an email's @ never opens it.
    await box.fill('see @RE')
    await expect(menu).toBeVisible()
    await box.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(box).toHaveValue('see @RE')
    await box.fill('mail me@src')
    await expect(menu).toHaveCount(0)

    // ---- Sent as typed: the agent gets the path; the bubble shows it as a chip.
    await box.fill('explain @src/main/ipc.ts please')
    await box.press('Enter')
    await expect(win.locator('.cmsg.user .cmd-chip.mention')).toHaveText('@src/main/ipc.ts')
    await expect(win.locator('.cmsg.agent').first()).toContainText(
      'Hello from fake claude: explain @src/main/ipc.ts please'
    )
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
