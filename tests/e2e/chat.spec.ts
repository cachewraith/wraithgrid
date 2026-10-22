import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'

// The chat view (ADR 0002) over a scripted stand-in for `claude -p` with stream-json.
const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')
const FAKE_CHAT = path.join(ROOT, 'tests/fixtures/fake-claude-chat.sh')

function chatPids(): number[] {
  try {
    return execFileSync('pgrep', ['-f', FAKE_CHAT], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(Number)
  } catch {
    return []
  }
}

async function launch(
  home: string,
  userData: string
): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  const win = await app.firstWindow()
  await win.waitForSelector('.app .tb')
  return { app, win }
}

test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('chat pane: streamed answer, approval, view switch, restore, no leftovers', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-chat-'))
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
            {
              id: 'p-chat',
              accountId: 'a-work',
              cwd: '~/proj',
              args: [],
              shell: false,
              title: 'proj',
              view: 'chat'
            }
          ],
          layout: null
        }
      ],
      activeWorkspace: 'ws-main',
      recentFolders: [],
      // Saved panes would show as terminals without a view; a new one opens as chat.
      settings: {}
    })
  )

  // The only pane; its title changes to the first message.
  const pane = (win: Page) => win.locator('section.pane').first()
  const composer = (win: Page) => pane(win).getByLabel('Message', { exact: true })

  try {
    let { app, win } = await launch(home, userData)
    await expect(pane(win).locator('.chat-hello')).toBeVisible()
    await expect(composer(win)).toHaveAttribute('placeholder', /Message Claude Code/)

    // ---- A streamed answer, rendered as markdown, from this account's config dir.
    await composer(win).fill('hi there')
    await composer(win).press('Enter')
    await expect(pane(win).locator('.cmsg.user')).toHaveText('hi there')
    // The first message names the chat, in its header and the sidebar.
    await expect(pane(win).locator('.ph-title')).toHaveText('hi there')
    const answer = pane(win).locator('.cmsg.agent').first()
    await expect(answer).toContainText('Hello from fake claude: hi there')
    await expect(answer.locator('strong')).toHaveText('fake')
    await expect(answer).toContainText(`config ${home}/.wraithgrid/accounts/work`)
    await expect(answer).not.toContainText('(full copy)')
    await expect(pane(win).locator('.cturn')).toContainText('1s')
    // The account's models, from the CLI's own list; Default reads as the model it means.
    await expect(pane(win).getByRole('button', { name: /^Model:/ })).toHaveText(/Opus 5\.5/)
    await expect(win.locator('.acct-sub')).toHaveText('Claude Pro')

    // ---- Switch model mid-chat (no restart), then effort (restart, same conversation).
    await pane(win)
      .getByRole('button', { name: /^Model:/ })
      .click()
    await win.getByRole('option', { name: /Sonnet 5\.5/ }).click()
    await expect(pane(win).getByRole('button', { name: /^Model:/ })).toHaveText(/Sonnet 5\.5/)
    await composer(win).fill('which model')
    await composer(win).press('Enter')
    await expect(pane(win).locator('.cmsg.agent').last()).toContainText('model sonnet, effort auto')
    await expect(pane(win).locator('.st')).toHaveText(/idle|done/)
    await pane(win)
      .getByRole('button', { name: /^Effort:/ })
      .click()
    await win.getByRole('option', { name: /^High/ }).click()
    await expect(composer(win)).toHaveAttribute('placeholder', /Message Claude Code/)
    await composer(win).fill('which effort')
    await composer(win).press('Enter')
    await expect(pane(win).locator('.cmsg.agent').last()).toContainText(
      'session resumed-fake-new, model sonnet, effort high'
    )

    // ---- Mode: switched live (no restart), Shift+Tab steps on, the header says so.
    const modeBtn = pane(win).getByRole('button', { name: /^Mode:/ })
    await expect(modeBtn).toHaveText('Ask before edits')
    await modeBtn.click()
    await win.getByRole('option', { name: /^Plan/ }).click()
    await expect(modeBtn).toHaveText('Plan')
    await expect(pane(win).locator('.ph-mode')).toHaveText('Plan')
    await composer(win).fill('which mode')
    await composer(win).press('Enter')
    await expect(pane(win).locator('.cmsg.agent').last()).toContainText(
      'session resumed-fake-new, model sonnet, effort high, mode plan'
    )
    // Sonnet has no auto mode here, so Shift+Tab goes Plan → Ask → Accept edits.
    await composer(win).press('Shift+Tab')
    await expect(modeBtn).toHaveText('Ask before edits')
    await composer(win).press('Shift+Tab')
    await expect(modeBtn).toHaveText('Accept edits')
    // Bypass takes a second click; auto is not offered for this model.
    await modeBtn.click()
    await expect(win.getByRole('option', { name: /^Auto/ })).toHaveCount(0)
    await win.getByRole('option', { name: /^Bypass permissions/ }).click()
    await expect(win.getByRole('option', { name: /^Click again to bypass/ })).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(modeBtn).toHaveText('Accept edits')
    // The second click switches live: claude was started allowing it.
    await modeBtn.click()
    await win.getByRole('option', { name: /^Bypass permissions/ }).click()
    await win.getByRole('option', { name: /^Click again to bypass/ }).click()
    await expect(modeBtn).toHaveText('Bypass permissions')
    await composer(win).fill('which mode')
    await composer(win).press('Enter')
    await expect(pane(win).locator('.cmsg.agent').last()).toContainText('mode bypassPermissions')
    await modeBtn.click()
    await win.getByRole('option', { name: /^Ask before edits/ }).click()
    await expect(modeBtn).toHaveText('Ask before edits')
    await expect(pane(win).locator('.ph-mode')).toHaveCount(0)

    // ---- A tool that needs approval: the pane says so, Allow runs it.
    await composer(win).fill('run it')
    await composer(win).press('Enter')
    const ask = pane(win).getByRole('alertdialog', { name: 'Allow Bash?' })
    await expect(ask).toBeVisible()
    await expect(ask).toContainText('rm -rf build')
    await expect(pane(win).locator('.st')).toHaveText('needs approval')
    await ask.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(ask).toBeHidden()
    await expect(pane(win).locator('.ct.ct-done')).toContainText('Remove build')
    await expect(pane(win).locator('.cmsg.agent').last()).toContainText('Ran it.')

    // ---- Stop interrupts the turn without an error.
    await composer(win).fill('slow')
    await composer(win).press('Enter')
    await pane(win).getByRole('button', { name: 'Stop (Esc)' }).click()
    await expect(pane(win).locator('.cnote', { hasText: 'Interrupted' })).toBeVisible()
    await expect(pane(win).locator('.cnote.error')).toHaveCount(0)
    await expect(pane(win).getByRole('button', { name: 'Stop (Esc)' })).toBeHidden()

    // ---- Terminal view continues the conversation in the CLI's own screen, then back.
    await pane(win).getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect
      .poll(async () => (await pane(win).locator('.xterm-rows').innerText()).replace(/\s+/g, ''))
      .toContain('ARGS=--continue')
    await expect.poll(() => chatPids()).toHaveLength(0)
    await pane(win).getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(pane(win).locator('.cmsg.user').first()).toHaveText('hi there')
    await composer(win).fill('again')
    await composer(win).press('Enter')
    await expect(pane(win).locator('.cmsg.agent').last()).toContainText(
      'session resumed-resumed-fake-new'
    )

    // ---- Quit and relaunch: the conversation view comes back and resumes its session.
    await app.close()
    await expect.poll(() => chatPids()).toHaveLength(0)
    ;({ app, win } = await launch(home, userData))
    await expect(pane(win).locator('.cmsg.user').first()).toHaveText('hi there')
    await expect(pane(win).locator('.chat-it.enter')).toHaveCount(0)
    await composer(win).fill('after restart')
    await composer(win).press('Enter')
    await expect(pane(win).locator('.cmsg.agent').last()).toContainText(
      'session resumed-resumed-resumed-fake-new'
    )

    // ---- New conversation empties the view and starts a fresh session.
    await pane(win).getByRole('button', { name: 'New conversation' }).click()
    await expect(pane(win).locator('.chat-hello')).toBeVisible()
    await composer(win).fill('fresh')
    await composer(win).press('Enter')
    await expect(pane(win).locator('.cmsg.agent').last()).toContainText('session fake-new')

    // ---- Closing stops its process; the chat goes to the project's History (while a turn
    // runs, closing asks first, as for a terminal).
    await expect(pane(win).locator('.st')).toHaveText(/idle|done/)
    await pane(win)
      .getByRole('button', { name: /Close pane/ })
      .click()
    await expect.poll(() => chatPids()).toHaveLength(0)
    const saved = path.join(userData, 'chats', 'p-chat.json')
    await expect.poll(() => fs.existsSync(saved)).toBe(true)
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    await side.locator('.ws-row', { hasText: 'main' }).click()
    const history = win.getByRole('region', { name: 'History' })
    await expect(history.locator('.pj-row', { hasText: 'fresh' })).toBeVisible()

    // ---- Reopening from History carries on the conversation, view and all.
    await history.locator('.pj-row', { hasText: 'fresh' }).click()
    await expect(pane(win).locator('.cmsg.user').last()).toHaveText('fresh')
    await composer(win).fill('back again')
    await composer(win).press('Enter')
    await expect(pane(win).locator('.cmsg.agent').last()).toContainText('session resumed-fake-new')

    // ---- Delete asks first: "Keep it" leaves the History entry alone.
    await expect(pane(win).locator('.st')).toHaveText(/idle|done/)
    await pane(win)
      .getByRole('button', { name: /Close pane/ })
      .click()
    await side.locator('.ws-row', { hasText: 'main' }).click()
    await history.getByRole('button', { name: 'Delete fresh' }).click()
    const confirm = win.getByRole('alertdialog', { name: 'Delete “fresh”?' })
    await confirm.getByRole('button', { name: 'Keep it' }).click()
    await expect(confirm).toBeHidden()
    await expect(history.locator('.pj-row', { hasText: 'fresh' })).toBeVisible()

    // ---- An open chat is deleted from its right-click menu: stopped, not archived, view gone.
    await history.locator('.pj-row', { hasText: 'fresh' }).click()
    await expect(pane(win).locator('.cmsg.user').last()).toHaveText('back again')
    await side.locator('.ws-row', { hasText: 'main' }).click()
    const openChats = win.getByRole('region', { name: 'Open chats' })
    await openChats.locator('.pj-row', { hasText: 'fresh' }).click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Delete chat…' }).click()
    await confirm.getByRole('button', { name: 'Delete chat' }).click()
    await expect(openChats).toHaveCount(0)
    await expect(history).toHaveCount(0)
    await expect.poll(() => chatPids()).toHaveLength(0)
    await expect.poll(() => fs.existsSync(saved)).toBe(false)
    await app.close()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
