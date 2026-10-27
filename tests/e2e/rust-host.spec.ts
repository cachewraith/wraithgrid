// ADR 0004 phase 4: panes run in the Rust background host by default; Settings → Advanced
// "Use the Node host" goes back to the Node one. Linux here (the cargo release binary).
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

for (const node of [false, true]) {
  test(`${node ? '"Use the Node host" runs the Node host' : 'the default runs panes in the Rust host'}`, async () => {
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
          shellPath: path.join(ROOT, 'tests/fixtures/fake-shell.sh'),
          ...(node ? { nodeHost: true } : {})
        }
      })
    )
    const before = new Set(rustHosts())
    // Only the setting decides here, not a WRAITHGRID_NODE_HOST from the test run.
    const { WRAITHGRID_NODE_HOST: _forced, ...rest } = process.env as Record<string, string>
    const env = { ...rest, HOME: home, WRAITHGRID_USER_DATA_DIR: data }
    const app = await electron.launch({ args: [path.join(ROOT, 'out/main/index.js')], env })
    try {
      const win = await app.firstWindow()
      const rows = win.locator('section.pane .xterm-rows')
      await expect(rows).toContainText('SHELL-ARGS=')
      const mine = rustHosts().filter((pid) => !before.has(pid))
      expect(mine).toHaveLength(node ? 0 : 1)
      // Typing reaches the pane through whichever host runs it.
      await win.locator('section.pane .xterm-screen').click()
      await win.keyboard.type('through the host\r')
      await expect(rows).toContainText('sh: through the host')

      // Settings → Advanced shows the switch as configured.
      await win.getByRole('button', { name: 'More' }).click()
      await win.getByRole('menuitem', { name: 'Settings' }).click()
      await win.getByRole('tab', { name: 'Advanced' }).click()
      const sw = win.getByRole('switch', { name: 'Use the Node host' })
      await expect(sw).toBeEnabled()
      await expect(sw).toHaveAttribute('aria-checked', String(node))
    } finally {
      await app.close()
      fs.rmSync(tmp, { recursive: true, force: true })
    }
    // Quitting stops the host it started.
    await expect.poll(() => rustHosts().filter((pid) => !before.has(pid))).toHaveLength(0)
  })
}
