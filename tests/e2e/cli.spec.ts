import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
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
const ELECTRON = path.join(ROOT, 'node_modules/.bin/electron')
const run = promisify(execFile)

async function launch(
  home: string,
  userData: string
): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({
    args: [MAIN],
    cwd: home,
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  const win = await app.firstWindow()
  await win.waitForSelector('.app .tb')
  return { app, win }
}

const pane = (win: Page, title: string) =>
  win.locator('section.pane', { has: win.locator('.ph-title', { hasText: title }) })
const paneText = async (win: Page, title: string): Promise<string> =>
  (await pane(win, title).locator('.xterm-rows').innerText()).replace(/\s+/g, '')

// Uses a bash stand-in for claude; Windows is covered by unit tests and CI builds.
test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('the wraithgrid command lists, reads, types into, waits on and opens panes', async () => {
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
      settings: { chatOnlyMigrated: true }
    })
  )
  const cli = (...args: string[]) =>
    run(ELECTRON, [MAIN, ...args], {
      cwd: path.join(home, 'proj'),
      env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData },
      timeout: 30_000
    })

  const { app, win } = await launch(home, userData)
  try {
    await expect.poll(() => paneText(win, 'alpha')).toContain('COLORTERM=truecolor')

    // Off by default: the command is refused and says where to turn it on.
    const refused = await cli('list').catch((e: { code: number; stderr: string }) => e)
    expect(refused).toMatchObject({ code: 1 })
    expect((refused as { stderr: string }).stderr).toMatch(/Settings → Command line/)

    await win.getByRole('button', { name: 'More' }).click()

    await win.getByRole('menuitem', { name: 'Settings' }).click()
    await win.getByRole('tab', { name: 'Advanced' }).click()
    await win.getByRole('switch', { name: 'Allow wraithgrid commands' }).click()
    await win.locator('header.top button.gh').first().click() // back to the grid

    await expect
      .poll(async () => (await cli('list').catch(() => ({ stdout: '' }))).stdout)
      .toMatch(/p-alpha\s+alpha\s+main\s+personal\s+claude\s+(idle|running)/)

    // Type a prompt; the pane answers; read shows it; wait sees it settle.
    await cli('send', 'alpha', 'from the cli')
    await expect.poll(() => paneText(win, 'alpha')).toContain('got:fromthecli')
    expect((await cli('read', 'alpha')).stdout).toContain('got: from the cli')
    expect((await cli('wait', 'p-alpha', '--quiet', '300', '--timeout', '20')).stdout.trim()).toBe(
      'idle'
    )

    // A new pane opens in the window under the given account and folder.
    const created = (await cli('new', '--account', 'personal', '--cwd', 'beta')).stdout.trim()
    expect(created).toMatch(/^p/)
    await expect(win.locator('section.pane')).toHaveCount(2)
    await expect
      .poll(async () => (await cli('read', created)).stdout.replace(/\s+/g, ''))
      .toContain(`PWD=${home}/proj/beta`.replace(/\s+/g, ''))

    // Without a display (ssh) the command still runs: it never starts a window system.
    const headless: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      WRAITHGRID_USER_DATA_DIR: userData
    }
    delete headless.DISPLAY
    delete headless.WAYLAND_DISPLAY
    const { stdout: listed } = await run(ELECTRON, [MAIN, 'list'], { env: headless })
    expect(listed).toMatch(/p-alpha\s+alpha/)

    // attach (H7): the pane's screen in a terminal, typing reaches it, Ctrl+] leaves it running.
    if (process.platform === 'linux') {
      const term = spawn('script', ['-qec', `${ELECTRON} ${MAIN} attach alpha`, '/dev/null'], {
        env: { ...headless, TERM: 'xterm-256color' }
      })
      let shown = ''
      term.stdout.on('data', (d: Buffer) => (shown += d.toString()))
      const exited = new Promise<number | null>((r) => term.on('exit', r))
      await expect.poll(() => shown, { timeout: 15_000 }).toContain('got: from the cli')
      term.stdin.write('typed in a tty\r')
      await expect.poll(() => paneText(win, 'alpha')).toContain('got:typedinatty')
      await expect.poll(() => shown).toContain('got: typed in a tty')
      term.stdin.write('\x1d')
      expect(await exited).toBe(0)
      expect(shown).toContain('detached from p-alpha; it keeps running')
      expect((await cli('list')).stdout).toMatch(
        /p-alpha\s+alpha\s+main\s+personal\s+claude\s+(idle|running)/
      )
    }
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
