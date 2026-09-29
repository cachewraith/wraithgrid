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

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')

function fakeClaudePids(): number[] {
  try {
    return execFileSync('pgrep', ['-f', FAKE_CLAUDE], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(Number)
  } catch {
    return [] // pgrep exits 1 when nothing matches
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

/** Terminal text of a pane, whitespace removed so wrapped lines still match. */
async function paneText(win: Page, title: string): Promise<string> {
  const pane = win.locator('section.pane', { has: win.locator('.ph-title', { hasText: title }) })
  return (await pane.locator('.xterm-rows').innerText()).replace(/\s+/g, '')
}

const squash = (s: string): string => s.replace(/\s+/g, '')

// Uses a bash stand-in for claude and pgrep; Windows is covered by unit tests and CI builds.
test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('accounts are isolated, the layout is restored, and no process outlives the app', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(path.join(home, 'proj', 'alpha'), { recursive: true })
  fs.mkdirSync(path.join(home, 'proj', 'beta'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: FAKE_CLAUDE,
      accounts: [
        {
          id: 'a-personal',
          name: 'personal',
          configDir: '~/.wraithgrid/accounts/personal',
          color: '#7c5cff',
          signedIn: true,
          imported: false
        },
        {
          id: 'a-work',
          name: 'work',
          configDir: '~/.wraithgrid/accounts/work',
          color: '#2dd4bf',
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
              id: 'p-alpha',
              accountId: 'a-personal',
              cwd: '~/proj/alpha',
              args: [],
              shell: false,
              title: 'alpha'
            },
            {
              id: 'p-beta',
              accountId: 'a-work',
              cwd: '~/proj/beta',
              args: ['-c'],
              shell: false,
              title: 'beta'
            }
          ],
          layout: null
        }
      ],
      activeWorkspace: 'ws-main',
      recentFolders: [],
      settings: {}
    })
  )

  try {
    // ---- First run: each pane gets its own account's config dir and folder.
    let { app, win } = await launch(home, userData)
    await expect
      .poll(() => paneText(win, 'alpha'))
      .toContain(squash(`CLAUDE_CONFIG_DIR=${home}/.wraithgrid/accounts/personal`))
    await expect
      .poll(() => paneText(win, 'beta'))
      .toContain(squash(`CLAUDE_CONFIG_DIR=${home}/.wraithgrid/accounts/work`))
    expect(await paneText(win, 'alpha')).toContain(squash(`PWD=${home}/proj/alpha`))
    expect(await paneText(win, 'beta')).toContain(squash(`PWD=${home}/proj/beta`))
    expect(await paneText(win, 'beta')).toContain('ARGS=-c')
    expect(fakeClaudePids()).toHaveLength(2)

    // Input reaches the right process.
    await win
      .locator('section.pane', { has: win.locator('.ph-title', { hasText: 'beta' }) })
      .locator('.xterm')
      .click()
    await win.keyboard.type('hello beta')
    await win.keyboard.press('Enter')
    await expect.poll(() => paneText(win, 'beta')).toContain('got:hellobeta')
    expect(await paneText(win, 'alpha')).not.toContain('hellobeta')

    // Change the layout: 2×2 adds two empty slots.
    await win.getByRole('button', { name: '2×2 grid' }).click()
    await expect(win.locator('button.slot')).toHaveCount(2)

    await app.close()
    expect(fakeClaudePids()).toEqual([])

    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'))
    expect(saved.workspaces[0].layout.type).toBe('split')

    // ---- Second run: the same layout, accounts and folders come back.
    ;({ app, win } = await launch(home, userData))
    await expect(win.getByRole('button', { name: '2×2 grid' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(win.locator('button.slot')).toHaveCount(2)
    await expect
      .poll(() => paneText(win, 'alpha'))
      .toContain(squash(`CLAUDE_CONFIG_DIR=${home}/.wraithgrid/accounts/personal`))
    await expect.poll(() => paneText(win, 'beta')).toContain(squash(`PWD=${home}/proj/beta`))
    await expect.poll(() => fakeClaudePids().length).toBe(2)

    await app.close()
    expect(fakeClaudePids()).toEqual([])
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
