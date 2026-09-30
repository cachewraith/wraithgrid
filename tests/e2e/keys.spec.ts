import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const RAW_KEYS = path.join(ROOT, 'tests/fixtures/raw-keys.sh')

// Uses a bash stand-in for claude that prints each input byte in hex.
test.skip(process.platform === 'win32', 'POSIX-only fixture')

/** Hex bytes the pane's process has received so far, e.g. "611b0d62". */
async function bytes(win: Page): Promise<string> {
  const text = await win.locator('section.pane .xterm-rows').innerText()
  return text.replace(/\s+/g, '').replace(/^.*READY/, '')
}

test('Shift+Enter reaches claude as ESC CR; Enter stays a bare CR', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: RAW_KEYS,
      accounts: [
        {
          id: 'a-one',
          name: 'one',
          configDir: '~/.wraithgrid/accounts/one',
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
            { id: 'p-keys', accountId: 'a-one', cwd: '~', args: [], shell: false, title: 'keys' }
          ],
          layout: null
        }
      ],
      activeWorkspace: 'ws-main',
      recentFolders: [],
      settings: {}
    })
  )

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    await expect.poll(() => win.locator('section.pane .xterm-rows').innerText()).toContain('READY')
    await win.locator('section.pane .xterm').click()

    await win.keyboard.type('a')
    await win.keyboard.press('Shift+Enter')
    await win.keyboard.type('b')
    await win.keyboard.press('Enter')
    await expect.poll(() => bytes(win)).toBe('611b0d620d')
  } finally {
    await app.close()
  }
})
