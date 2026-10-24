import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

// codex in the chat view and the sign-in dialog (#40), against tests/fixtures/fake-codex.mjs
// (codex-cli 0.163.0's app-server and login shapes).
const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CODEX = path.join(ROOT, 'tests/fixtures/fake-codex.mjs')

test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('codex: sign in from the dialog, then chat with approvals, stop, model and mode', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-codex-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: '',
      accounts: [
        {
          id: 'a-cx',
          name: 'cx',
          cli: 'codex',
          configDir: '~/.wraithgrid/accounts/cx',
          color: '#7c5cff',
          signedIn: false,
          imported: false
        }
      ],
      workspaces: [
        {
          id: 'ws-main',
          name: 'main',
          panes: [
            {
              id: 'p-cx',
              accountId: 'a-cx',
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
      settings: { cliPaths: { codex: FAKE_CODEX } }
    })
  )
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  const pane = (win: Page) => win.locator('section.pane').first()
  const composer = (win: Page) => pane(win).getByLabel('Message', { exact: true })
  const last = (win: Page) => pane(win).locator('.cmsg.agent').last()
  try {
    const win = await app.firstWindow()
    await win.waitForSelector('.app .tb')

    // ---- Sign in: the dialog shows codex's link and one-time code, then who is signed in.
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    await side.getByRole('button', { name: /Switch account/ }).click()
    await win.getByRole('menuitem', { name: 'Manage accounts' }).click()
    await win.locator('.tr', { hasText: 'cx' }).getByRole('button', { name: 'Login' }).click()
    const login = win.getByRole('dialog', { name: 'Sign in to ChatGPT (Codex) as cx' })
    await expect(login.getByLabel('One-time code')).toHaveText('FAKE-C0DE1')
    await expect(login.getByRole('button', { name: 'Open sign-in page' })).toBeVisible()
    await expect(login.getByLabel('Sign-in code')).toHaveCount(0)
    const done = win.getByRole('dialog', { name: 'cx is signed in' })
    await expect(done).toContainText('Signed in · ChatGPT')
    await done.getByRole('button', { name: 'Done' }).click()
    expect(fs.existsSync(path.join(home, '.wraithgrid/accounts/cx/auth.json'))).toBe(true)

    // ---- Chat: a streamed answer with the turn's settings.
    // Back to the chats.
    await win.locator('.top .btn.gh').click()
    await expect(composer(win)).toHaveAttribute('placeholder', /Message Codex CLI/)
    await composer(win).fill('hi')
    await composer(win).press('Enter')
    await expect(last(win)).toContainText(
      'Hello from fake codex: hi (thread cx-new, model default, effort default, approval untrusted, sandbox workspaceWrite)'
    )
    await expect(last(win).locator('strong')).toHaveText('fake')

    // ---- An approval: Allow runs it.
    await composer(win).fill('run it')
    await composer(win).press('Enter')
    const ask = pane(win).getByRole('alertdialog', { name: 'Allow Shell?' })
    await expect(ask).toContainText('rm -rf build')
    await ask.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(pane(win).locator('.ct.ct-done').last()).toContainText('rm -rf build')
    await expect(last(win)).toContainText('Ran it.')

    // ---- Stop interrupts the turn over the pipe.
    await composer(win).fill('slow')
    await composer(win).press('Enter')
    await pane(win).getByRole('button', { name: 'Stop (Esc)' }).click()
    await expect(pane(win).locator('.cnote', { hasText: 'Interrupted' })).toBeVisible()
    await expect(pane(win).getByRole('button', { name: 'Stop (Esc)' })).toBeHidden()

    // ---- Usage (#53): codex's limits in the pill and on the screen, its tokens, no cost.
    const pill = win.locator('.u-pill')
    await expect(pill).toHaveText('12%')
    await pill.click()
    const acct = win.getByRole('group', { name: 'Account cx' })
    await expect(acct).toContainText('Current session')
    await expect(acct).toContainText('12%')
    await expect(acct).toContainText('Weekly')
    await expect(acct).toContainText(/K tokens over \d+ turns in the last 7 days/)
    await expect(acct).not.toContainText('$')
    await expect(win.locator('.u-tbl td').last()).toHaveText('–')
    await pill.click()

    // ---- Model and mode from codex's list switch with the next turn, no restart.
    await pane(win)
      .getByRole('button', { name: /^Model:/ })
      .click()
    await win.getByRole('option', { name: /GPT-Mini/ }).click()
    await pane(win)
      .getByRole('button', { name: /^Mode:/ })
      .click()
    await expect(win.getByRole('option', { name: /^Auto/ })).toHaveCount(0)
    await win.getByRole('option', { name: /^Plan/ }).click()
    await composer(win).fill('again')
    await composer(win).press('Enter')
    await expect(last(win)).toContainText(
      'again (thread cx-new, model gpt-mini, effort default, approval on-request, sandbox readOnly)'
    )
    await expect(pane(win).locator('.st')).toHaveText(/idle|done/)
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('a codex chat continues as another codex account: rollout copied, same thread (#60)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-codex-switch-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  // Both signed in: the fake reads `auth.json` in each account's CODEX_HOME.
  for (const name of ['work', 'home']) {
    fs.mkdirSync(path.join(home, '.wraithgrid/accounts', name), { recursive: true })
    fs.writeFileSync(path.join(home, '.wraithgrid/accounts', name, 'auth.json'), '{}')
  }
  const account = (id: string, name: string, cli = 'codex') => ({
    id,
    name,
    cli,
    configDir: `~/.wraithgrid/accounts/${name}`,
    color: '#7c5cff',
    signedIn: true,
    imported: false
  })
  fs.writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: '',
      accounts: [
        account('a-work', 'work'),
        account('a-home', 'home'),
        account('a-cl', 'claude-one', 'claude')
      ],
      workspaces: [
        {
          id: 'ws-main',
          name: 'main',
          panes: [{ id: 'p-cx', accountId: 'a-work', cwd: '~/proj', title: 'proj', view: 'chat' }],
          layout: null
        }
      ],
      activeWorkspace: 'ws-main',
      recentFolders: [],
      settings: { cliPaths: { codex: FAKE_CODEX }, checkUpdatesOnLaunch: false }
    })
  )
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  const rollout = (name: string): string =>
    path.join(
      home,
      '.wraithgrid/accounts',
      name,
      'sessions/2026/10/23/rollout-2026-10-23T00-00-00-cx-new.jsonl'
    )
  try {
    const win = await app.firstWindow()
    const box = win.getByLabel('Message', { exact: true })
    await box.fill('remember PLUM')
    await box.press('Enter')
    const agent = win.locator('.cmsg.agent')
    await expect(agent.first()).toContainText('remember PLUM (thread cx-new')
    await expect.poll(() => fs.existsSync(rollout('work'))).toBe(true)

    // Every provider is offered; another Codex account still copies the same thread.
    await win.getByRole('button', { name: 'Account: work. Continue as another account' }).click()
    const list = win.getByRole('listbox', { name: 'Accounts' })
    await expect(list.getByRole('option')).toHaveCount(3)
    await expect(list.getByRole('option', { name: /claude-one/ })).toHaveCount(1)
    await list.getByRole('option', { name: /^home/ }).click()
    const dlg = win.getByRole('dialog', { name: 'Continue this conversation as home?' })
    await dlg.getByRole('button', { name: 'Continue as home' }).click()
    await expect(dlg).toHaveCount(0)

    // Copied into home's CODEX_HOME (the fake refuses to resume a thread it has no file for).
    expect(fs.readFileSync(rollout('home'), 'utf8')).toContain('remember PLUM')
    await expect(win.getByRole('separator', { name: /^Continued as home · / })).toBeVisible()
    await box.fill('what was it?')
    await box.press('Enter')
    await expect(agent.nth(1)).toContainText('what was it? (thread cx-new')
    await expect(win.locator('.cnote.error')).toHaveCount(0)
    // The resumed thread is home's copy now; work keeps its own.
    await expect.poll(() => fs.readFileSync(rollout('home'), 'utf8')).toContain('what was it?')
    expect(fs.readFileSync(rollout('work'), 'utf8')).not.toContain('what was it?')
  } finally {
    await app.close()
  }
})
