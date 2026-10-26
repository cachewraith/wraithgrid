// #129: a busy chat says so everywhere while the turn goes on after its text: the working line
// under the thread, and `working` in the sidebar (chat row, closed project, collapsed rail).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('text, then a long tool call: the working line and the sidebar both say working', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-working-'))
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
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: data }
  })
  const win = await app.firstWindow()
  try {
    const box = win.getByLabel('Message', { exact: true })
    await box.fill('template file')
    await box.press('Enter')
    const pane = win.locator('section.pane')
    await expect(pane.locator('.cmsg.agent').last()).toContainText('Now the HTML template')
    // The text is all there; the turn goes on: the working line shows under it.
    const working = pane.locator('.chat-working')
    await expect(working).toBeVisible({ timeout: 2500 })
    await expect(working).toContainText('Working')

    // The sidebar: the chat row, then the closed project, then the collapsed rail.
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    await expect(side.locator('.side-chat .sch-st')).toHaveText('working')
    await side.getByRole('button', { name: 'Hide chats in project' }).click()
    await expect(side.locator('.proj .ws-row .sch-st')).toHaveText('working')
    await win.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(win.locator('.rail-ws.working')).toHaveCount(1)
    await expect(win.locator('.rail-ws.working')).toHaveAttribute('aria-label', /working/)
    await win.getByRole('button', { name: 'Expand sidebar' }).click()

    // The turn ends: the line goes and the sidebar settles.
    await expect(pane.locator('.cmsg.agent').last()).toContainText('Wrote report.html.', {
      timeout: 10_000
    })
    await expect(working).toHaveCount(0)
    await expect(side.locator('.proj .ws-row .sch-st')).toHaveCount(0)
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
