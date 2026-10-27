// ADR 0004: terminal panes run in the Rust background host, the only one since phase 4b; it
// starts with the window and stops on quit. Linux here (the cargo release binary).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const BIN = path.join(ROOT, 'host-rs/target/release/wraithgrid-host')
test.skip(process.platform !== 'linux' || !fs.existsSync(BIN), 'Linux with the Rust host built')

/** Pids of Rust hosts started from this checkout. */
const rustHosts = (): number[] => {
  try {
    return execFileSync('pgrep', ['-f', `^${BIN}$`], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number)
  } catch {
    return []
  }
}

test('terminal panes run in the Rust host', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-rusthost-'))
  const home = path.join(tmp, 'home')
  const data = path.join(tmp, 'data')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(data)
  fs.writeFileSync(
    path.join(data, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: '',
      accounts: [],
      workspaces: [
        {
          id: 'ws',
          name: 'main',
          panes: [
            { id: 'p-sh', accountId: null, cwd: '~/proj', args: [], shell: true, title: 'sh' }
          ],
          layout: null
        }
      ],
      activeWorkspace: 'ws',
      recentFolders: [],
      settings: {
        checkUpdatesOnLaunch: false,
        shellPath: path.join(ROOT, 'tests/fixtures/fake-shell.sh')
      }
    })
  )
  const before = new Set(rustHosts())
  const env = { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: data }
  const app = await electron.launch({ args: [path.join(ROOT, 'out/main/index.js')], env })
  try {
    const win = await app.firstWindow()
    const rows = win.locator('section.pane .xterm-rows')
    await expect(rows).toContainText('SHELL-ARGS=')
    const mine = rustHosts().filter((pid) => !before.has(pid))
    expect(mine).toHaveLength(1)
    // Typing reaches the pane through whichever host runs it.
    await win.locator('section.pane .xterm-screen').click()
    await win.keyboard.type('through the host\r')
    await expect(rows).toContainText('sh: through the host')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  // Quitting stops the host it started.
  await expect.poll(() => rustHosts().filter((pid) => !before.has(pid))).toHaveLength(0)
})
