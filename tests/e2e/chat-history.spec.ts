// #132: ↑/↓ in the chat box step through the prompts sent in this chat, like a shell.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('↑/↓ recall sent prompts, keep the draft, leave multi-line and the / menu alone', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-history-'))
  const home = path.join(tmp, 'home')
  const data = path.join(tmp, 'data')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(data)
  fs.writeFileSync(
    path.join(data, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: path.join(ROOT, 'tests/fixtures/fake-claude.sh'),
      accounts: [
        {
          id: 'work',
          name: 'work',
          cli: 'claude',
          configDir: '~/.wraithgrid/accounts/work',
          color: '#7c5cff',
          signedIn: true
        }
      ],
      workspaces: [
        {
          id: 'ws',
          name: 'project',
          folder: '~/proj',
          panes: [{ id: 'p1', accountId: 'work', cwd: '~/proj', title: 'main chat', view: 'chat' }],
          layout: { type: 'pane', paneId: 'p1' }
        }
      ],
      activeWorkspace: 'ws',
      recentFolders: [],
      settings: { checkUpdatesOnLaunch: false }
    })
  )
  const launch = () =>
    electron.launch({
      args: [path.join(ROOT, 'out/main/index.js')],
      env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: data }
    })
  let app = await launch()
  try {
    const win = await app.firstWindow()
    const box = win.getByLabel('Message', { exact: true })
    const agent = win.locator('section.pane .cmsg.agent')
    for (const prompt of ['first prompt', 'second prompt', 'second prompt']) {
      await box.fill(prompt)
      await box.press('Enter')
      await expect(agent.last()).toContainText(prompt)
    }
    await expect(win.getByRole('button', { name: 'Stop (Esc)' })).toHaveCount(0)

    // ↑ goes back (the repeat is stored once), ↓ comes forward, then the draft returns.
    await box.fill('my draft')
    await box.press('ArrowUp')
    await expect(box).toHaveValue('second prompt')
    await box.press('ArrowUp')
    await expect(box).toHaveValue('first prompt')
    await box.press('ArrowUp')
    await expect(box).toHaveValue('first prompt')
    await box.press('ArrowDown')
    await expect(box).toHaveValue('second prompt')
    await box.press('ArrowDown')
    await expect(box).toHaveValue('my draft')

    // Editing a recalled prompt ends browsing: the next ↑ starts from the newest again.
    await box.press('ArrowUp')
    await box.press('End')
    await box.pressSequentially(' again')
    await expect(box).toHaveValue('second prompt again')
    await box.press('ArrowUp')
    await expect(box).toHaveValue('second prompt')

    // Multi-line: ↑ from the second line moves the caret, not through history.
    await box.fill('line one\nline two')
    await box.press('End')
    await box.press('ArrowUp')
    await expect(box).toHaveValue('line one\nline two')
    await box.press('ArrowUp')
    await expect(box).toHaveValue('second prompt')

    // The / menu keeps ↑/↓ for its items.
    await box.fill('/')
    const menu = win.getByRole('listbox')
    await expect(menu).toBeVisible()
    await box.press('ArrowUp')
    await expect(box).toHaveValue('/')
    await expect(menu).toBeVisible()
    await box.press('Escape')
    await box.fill('')
    // The chat view is saved after a short debounce.
    await expect
      .poll(() => {
        try {
          return fs.readFileSync(path.join(data, 'chats', 'p1.json'), 'utf8')
        } catch {
          return ''
        }
      })
      .toContain('second prompt')
  } finally {
    await app.close()
  }

  // Kept with the saved conversation: after a restart ↑ still recalls.
  app = await launch()
  try {
    const win = await app.firstWindow()
    const box = win.getByLabel('Message', { exact: true })
    await expect(win.locator('section.pane .cmsg.user').last()).toHaveText('second prompt')
    await box.click()
    await box.press('ArrowUp')
    await expect(box).toHaveValue('second prompt')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
