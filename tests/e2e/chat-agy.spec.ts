import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

// agy in the chat view (#41), against tests/fixtures/fake-agy.sh (agy 1.4.4's shapes).
const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_AGY = path.join(ROOT, 'tests/fixtures/fake-agy.sh')

test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('agy chat: answer, models with effort, refused tool, stop and mode restart and resume', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-agy-'))
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
          id: 'a-agy',
          name: 'agy',
          cli: 'agy',
          configDir: '~/.wraithgrid/accounts/agy',
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
              id: 'p-agy',
              accountId: 'a-agy',
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
      settings: { cliPaths: { agy: FAKE_AGY } }
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
    await expect(pane(win).locator('.chat-hello')).toBeVisible()
    await expect(composer(win)).toHaveAttribute('placeholder', /Message Antigravity CLI/)

    // ---- A streamed answer, as markdown.
    await composer(win).fill('hi')
    await composer(win).press('Enter')
    await expect(last(win)).toContainText('Hello from fake agy: hi (conversation agy-new')
    await expect(last(win).locator('strong')).toHaveText('fake')

    // ---- A tool card, with its output.
    await composer(win).fill('read it')
    await composer(win).press('Enter')
    await expect(pane(win).locator('.ct.ct-done').last()).toContainText('/tmp/notes.txt')
    await expect(last(win)).toContainText('It says hello.')

    // ---- Models from `agy models`, levels folded into Effort; a switch restarts and resumes.
    await pane(win)
      .getByRole('button', { name: /^Model:/ })
      .click()
    await expect(win.getByRole('option', { name: /Gemini 3\.8 Flash/ })).toHaveCount(1)
    await win.getByRole('option', { name: /Gemini 3\.8 Flash/ }).click()
    await expect(composer(win)).toHaveAttribute('placeholder', /Message Antigravity CLI/)
    await pane(win)
      .getByRole('button', { name: /^Effort:/ })
      .click()
    await win.getByRole('option', { name: /^Low/ }).click()
    await expect(composer(win)).toHaveAttribute('placeholder', /Message Antigravity CLI/)
    await composer(win).fill('which model')
    await composer(win).press('Enter')
    await expect(last(win)).toContainText(
      'conversation agy-new, model gemini-3.8-flash, effort low'
    )

    // ---- A tool that needs approval: agy can't ask here, so the chat says what it skipped.
    await composer(win).fill('run it')
    await composer(win).press('Enter')
    await expect(pane(win).locator('.cnote.error').last()).toContainText('skipped: RunCommand')

    // ---- Stop: agy has no interrupt, so the chat restarts it and carries on.
    await composer(win).fill('slow')
    await composer(win).press('Enter')
    await pane(win).getByRole('button', { name: 'Stop (Esc)' }).click()
    await expect(pane(win).locator('.cnote', { hasText: 'Interrupted' })).toBeVisible()
    await expect(pane(win).getByRole('button', { name: 'Stop (Esc)' })).toBeHidden()
    await expect(composer(win)).toHaveAttribute('placeholder', /Message Antigravity CLI/)
    await composer(win).fill('still there')
    await composer(win).press('Enter')
    await expect(last(win)).toContainText('still there (conversation agy-new')

    // ---- Modes: only agy's; Plan restarts it in plan mode.
    await pane(win)
      .getByRole('button', { name: /^Mode:/ })
      .click()
    await expect(win.getByRole('option', { name: /^Auto/ })).toHaveCount(0)
    await expect(win.getByRole('option', { name: /^Don't ask/ })).toHaveCount(0)
    await expect(win.getByRole('option', { name: /^Ask before edits/ })).toContainText(
      "can't ask here"
    )
    await win.getByRole('option', { name: /^Plan/ }).click()
    await expect(composer(win)).toHaveAttribute('placeholder', /Message Antigravity CLI/)
    await composer(win).fill('plan it')
    await composer(win).press('Enter')
    await expect(last(win)).toContainText('mode plan')
    await expect(pane(win).locator('.st')).toHaveText(/idle|done/)
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
