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
import { hostPaths } from '../../src/host/paths'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')

function pids(pattern: string): number[] {
  try {
    return execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' })
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
    // The crash step below may write a core dump into the working directory.
    cwd: home,
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  const win = await app.firstWindow()
  await win.waitForSelector('.app .tb')
  return { app, win }
}

const pane = (win: Page) =>
  win.locator('section.pane', { has: win.locator('.ph-title', { hasText: 'alpha' }) })
const paneText = async (win: Page): Promise<string> =>
  (await pane(win).locator('.xterm-rows').innerText()).replace(/\s+/g, '')

/** The host's run dir; a host that exited cleanly removed it. */
const hostDir = (userData: string): string =>
  hostPaths({
    platform: process.platform,
    env: process.env,
    userData,
    tmpDir: os.tmpdir(),
    uid: process.getuid?.() ?? -1,
    userName: os.userInfo().username
  }).dir

function setCloseMode(userData: string, mode: 'keep' | 'stop' | 'ask'): void {
  const file = path.join(userData, 'config.json')
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
  cfg.settings.onWindowClose = mode
  fs.writeFileSync(file, JSON.stringify(cfg))
}

// Uses a bash stand-in for claude and pgrep; Windows is covered by unit tests and CI builds.
test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('agents kept running survive quit and reattach with their screen; stop leaves nothing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(path.join(home, 'proj', 'alpha'), { recursive: true })
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
            }
          ],
          layout: null
        }
      ],
      activeWorkspace: 'ws-main',
      recentFolders: [],
      settings: { onWindowClose: 'keep' }
    })
  )

  try {
    // ---- First run: start the agent and give it some work.
    let { app, win } = await launch(home, userData)
    await expect.poll(() => paneText(win)).toContain('COLORTERM=truecolor')
    await pane(win).locator('.xterm').click()
    await win.keyboard.type('first prompt')
    await win.keyboard.press('Enter')
    await expect.poll(() => paneText(win)).toContain('got:firstprompt')
    const [agent] = pids(FAKE_CLAUDE)
    expect(agent).toBeTruthy()

    // Quit with "keep": the agent and its host stay.
    await app.close()
    expect(pids(FAKE_CLAUDE)).toEqual([agent])

    // ---- Second run: the same process, its screen back, input still reaches it.
    ;({ app, win } = await launch(home, userData))
    await expect.poll(() => paneText(win)).toContain('got:firstprompt')
    expect(await paneText(win)).not.toContain('--continue')
    expect(pids(FAKE_CLAUDE)).toEqual([agent])
    await pane(win).locator('.xterm').click()
    await win.keyboard.type('second prompt')
    await win.keyboard.press('Enter')
    await expect.poll(() => paneText(win)).toContain('got:secondprompt')

    // A renderer crash keeps the agent: the reloaded window reattaches it.
    await app.evaluate(
      ({ BrowserWindow }) =>
        new Promise<void>((resolve) => {
          const wc = BrowserWindow.getAllWindows()[0]!.webContents
          wc.once('did-finish-load', () => resolve())
          wc.forcefullyCrashRenderer()
        })
    )
    // Playwright's page stays "crashed"; read the reloaded page through main instead.
    const reloadedText = (): Promise<string> =>
      app
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
            "document.querySelector('.xterm-rows')?.innerText ?? ''"
          )
        )
        .then((t: string) => t.replace(/\s+/g, ''))
    await expect.poll(reloadedText).toContain('got:secondprompt')
    expect(pids(FAKE_CLAUDE)).toEqual([agent])

    // An agent that ends while Wraithgrid is closed shows its exit on the next launch.
    await app.close()
    process.kill(agent!, 'SIGTERM')
    await expect.poll(() => pids(FAKE_CLAUDE)).toEqual([])
    ;({ app, win } = await launch(home, userData))
    await expect(pane(win).locator('.pexit')).toBeVisible()
    await expect.poll(() => paneText(win)).toContain('got:secondprompt')

    // ---- Stop: restarting the pane, then quitting with "stop", leaves no process.
    await pane(win)
      .locator('.pexit')
      .getByRole('button', { name: /Restart/ })
      .click()
    await expect.poll(() => pids(FAKE_CLAUDE).length).toBe(1)
    await app.close() // still "keep"
    setCloseMode(userData, 'stop')
    ;({ app, win } = await launch(home, userData))
    await expect.poll(() => paneText(win)).toContain('COLORTERM=truecolor')
    await app.close()
    expect(pids(FAKE_CLAUDE)).toEqual([])
    await expect.poll(() => fs.existsSync(hostDir(userData))).toBe(false)

    // ---- Ask: the close button asks; "keep" + remember saves it and leaves only the tray.
    setCloseMode(userData, 'ask')
    ;({ app, win } = await launch(home, userData))
    await expect.poll(() => paneText(win)).toContain('COLORTERM=truecolor')
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: true })) as never
    })
    await win.getByRole('button', { name: 'Close window' }).click()
    await expect.poll(() => app.windows().length).toBe(0)
    expect(pids(FAKE_CLAUDE)).toHaveLength(1)
    await expect
      .poll(
        () =>
          JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8')).settings
            .onWindowClose
      )
      .toBe('keep')
    await app.close()
    expect(pids(FAKE_CLAUDE)).toHaveLength(1)

    // Clean up through the app: "stop" ends the kept agent and the host.
    setCloseMode(userData, 'stop')
    ;({ app, win } = await launch(home, userData))
    await expect.poll(() => paneText(win)).toContain('COLORTERM=truecolor')
    await app.close()
    expect(pids(FAKE_CLAUDE)).toEqual([])
    await expect.poll(() => fs.existsSync(hostDir(userData))).toBe(false)
  } finally {
    for (const pid of pids(FAKE_CLAUDE)) process.kill(pid, 'SIGKILL')
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
