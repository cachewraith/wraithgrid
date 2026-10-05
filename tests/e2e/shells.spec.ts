import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')
const FAKE_SHELL = path.join(ROOT, 'tests/fixtures/fake-shell.sh')

test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('a custom shell runs with its args; panes never inherit the launching terminal', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-shells-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: FAKE_CLAUDE,
      accounts: [],
      workspaces: [{ id: 'ws-main', name: 'main', panes: [], layout: null }],
      activeWorkspace: 'ws-main',
      recentFolders: ['~/proj'],
      settings: { checkUpdatesOnLaunch: false }
    })
  )

  // As if started from a VS Code terminal inside tmux, 33 columns wide.
  const app = await electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      HOME: home,
      WRAITHGRID_USER_DATA_DIR: userData,
      COLUMNS: '33',
      TERM_PROGRAM: 'vscode',
      TMUX: '/tmp/tmux-1000/default,1,0'
    }
  })
  try {
    const win = await app.firstWindow()

    // Settings: the picker lists real shells; choose a custom one with arguments.
    await win.getByRole('button', { name: 'Settings' }).click()
    const picker = win.getByRole('radiogroup', { name: 'Shell for plain panes' })
    await expect(picker.getByRole('radio', { name: /Automatic/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(picker.getByRole('radio', { name: /^(bash|sh|fish|zsh)/ }).first()).toBeVisible()
    await picker.getByRole('radio', { name: /Custom/ }).click()
    await win.getByLabel('Shell path').fill(FAKE_SHELL)
    await win.getByLabel('Shell arguments').fill('--login "two words"')

    // New pane → plain shell.
    await win.keyboard.press('Control+Shift+N')
    await expect(win.locator('.cmd')).toContainText('fake-shell.sh')
    await win.getByRole('button', { name: 'Create pane' }).click()
    const rows = win.locator('section.pane .xterm-rows')
    await expect(rows).toContainText('SHELL-ARGS=--login two words')
    await expect(rows).toContainText('LEAK= LANG-SET=yes')

    // A shell that is gone is reported, not swapped for another.
    await win.getByRole('button', { name: 'Settings' }).click()
    await win.getByLabel('Shell path').fill('/nowhere/elvish')
    await win.keyboard.press('Control+Shift+N')
    await win.getByRole('button', { name: 'Create pane' }).click()
    await expect(win.locator('section.pane .xterm-rows').last()).toContainText(
      'Shell not found: /nowhere/elvish'
    )
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
