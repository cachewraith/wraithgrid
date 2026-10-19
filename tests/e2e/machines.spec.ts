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
const FAKE_SSH = path.join(ROOT, 'tests/fixtures/fake-ssh.sh')
const ELECTRON = path.join(ROOT, 'node_modules/.bin/electron')

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

const pane = (win: Page, title: string) =>
  win.locator('section.pane', { has: win.locator('.ph-title', { hasText: title }) })
const paneText = async (win: Page, title: string): Promise<string> =>
  (await pane(win, title).locator('.xterm-rows').innerText()).replace(/\s+/g, '')
const squash = (s: string): string => s.replace(/\s+/g, '')

// Uses bash stand-ins for claude and ssh; Windows is covered by unit tests and CI builds.
test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('a workspace on another machine runs its panes there, over ssh, and they outlive the window', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  // "The other machine": its own home, user data and a PATH whose claude is the fake one.
  const remoteHome = path.join(tmp, 'remote-home')
  const remoteData = path.join(tmp, 'remote-data')
  const remoteBin = path.join(tmp, 'remote-bin')
  for (const d of [
    path.join(home, 'proj', 'alpha'),
    userData,
    path.join(remoteHome, 'proj', 'gamma'),
    remoteData,
    remoteBin
  ])
    fs.mkdirSync(d, { recursive: true })
  fs.symlinkSync(FAKE_CLAUDE, path.join(remoteBin, 'claude'))
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
      machines: [{ id: 'm-lab', name: 'lab', sshHost: 'lab' }],
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
        },
        {
          id: 'ws-lab',
          name: 'labwork',
          machineId: 'm-lab',
          panes: [
            {
              id: 'p-gamma',
              accountId: 'a-personal',
              cwd: '~/proj/gamma',
              args: [],
              shell: false,
              title: 'gamma'
            }
          ],
          layout: null
        }
      ],
      activeWorkspace: 'ws-main',
      recentFolders: [],
      settings: { onWindowClose: 'stop' }
    })
  )
  const env = {
    ...process.env,
    HOME: home,
    WRAITHGRID_USER_DATA_DIR: userData,
    WRAITHGRID_SSH: FAKE_SSH,
    WG_REMOTE_HOME: remoteHome,
    WG_REMOTE_DATA: remoteData,
    WG_REMOTE_PATH: remoteBin,
    WG_ELECTRON: ELECTRON,
    WG_MAIN: MAIN
  }
  const launch = async (): Promise<{ app: ElectronApplication; win: Page }> => {
    const app = await electron.launch({ args: [MAIN], cwd: home, env })
    const win = await app.firstWindow()
    await win.waitForSelector('.app .tb')
    return { app, win }
  }
  const remoteDir = hostPaths({
    platform: process.platform,
    env: process.env,
    userData: remoteData,
    tmpDir: os.tmpdir(),
    uid: process.getuid?.() ?? -1,
    userName: os.userInfo().username
  }).dir

  /** Stops "the lab": its host's pid is in its lock file. */
  const stopLab = (): void => {
    try {
      process.kill(Number(fs.readFileSync(path.join(remoteDir, 'host.lock'), 'utf8')), 'SIGTERM')
    } catch {
      // Not running.
    }
  }

  try {
    let { app, win } = await launch()
    await win.locator('.ws-row', { hasText: 'labwork' }).click()
    // Resolved on the other machine: its home, its account dir, its claude.
    await expect
      .poll(() => paneText(win, 'gamma'), { timeout: 20_000 })
      .toContain(squash(`PWD=${remoteHome}/proj/gamma`))
    expect(await paneText(win, 'gamma')).toContain(
      squash(`CLAUDE_CONFIG_DIR=${remoteHome}/.wraithgrid/accounts/personal`)
    )
    await expect(win.locator('.ws-mach', { hasText: 'lab' })).toBeVisible()
    await expect.poll(() => paneText(win, 'gamma')).toContain('COLORTERM=truecolor')
    await pane(win, 'gamma').locator('.xterm').click()
    await win.keyboard.type('over ssh')
    await win.keyboard.press('Enter')
    await expect.poll(() => paneText(win, 'gamma')).toContain('got:overssh')

    // Settings → Machines → Test reaches it.
    await win.getByRole('button', { name: 'Settings' }).click()
    await win.getByRole('button', { name: 'Test' }).click()
    await expect(win.getByText(/Connected: Wraithgrid .*, 1 agent running/)).toBeVisible({
      timeout: 20_000
    })

    // Quitting with "stop" ends this computer's agents only: the lab's keeps running.
    // The lab runs claude through its own PATH (remote-bin/claude), this computer the fixture.
    const labClaude = path.join(remoteBin, 'claude')
    const [remoteAgent] = pids(labClaude)
    expect(remoteAgent).toBeTruthy()
    await app.close()
    expect(pids(FAKE_CLAUDE)).toEqual([])
    expect(pids(labClaude)).toEqual([remoteAgent])

    // The next launch reattaches it, screen and all.
    ;({ app, win } = await launch())
    await win.locator('.ws-row', { hasText: 'labwork' }).click()
    await expect.poll(() => paneText(win, 'gamma'), { timeout: 20_000 }).toContain('got:overssh')
    expect(pids(labClaude)).toEqual([remoteAgent])
    await app.close()

    // Stopping the lab's host ends its agent and leaves nothing behind.
    stopLab()
    await expect.poll(() => fs.existsSync(remoteDir)).toBe(false)
    await expect.poll(() => pids(labClaude)).toEqual([])
  } finally {
    stopLab()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
