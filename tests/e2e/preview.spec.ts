// Web preview (#74): a project's dev server runs in a preview pane and its page shows there,
// in the preview's own session; closing the pane stops the server.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const SERVER = path.join(ROOT, 'tests/fixtures/dev-server.mjs')

test('a preview runs the dev server, shows its page and stops with the pane', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-preview-'))
  const home = path.join(tmp, 'home')
  const data = path.join(tmp, 'data')
  fs.mkdirSync(path.join(home, 'site'), { recursive: true })
  fs.mkdirSync(data)
  fs.writeFileSync(
    path.join(home, 'site', 'package.json'),
    JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } })
  )
  fs.writeFileSync(
    path.join(data, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: '',
      accounts: [],
      workspaces: [{ id: 'ws', name: 'site', folder: '~/site', panes: [], layout: null }],
      activeWorkspace: 'ws',
      recentFolders: [],
      settings: { checkUpdatesOnLaunch: false }
    })
  )
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: data }
  })
  const win = await app.firstWindow()
  const saved = () => JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'))
  // The preview's page lives in its own web contents, not in the app's page.
  const pageText = () =>
    app.evaluate(async ({ webContents }) => {
      const wv = webContents.getAllWebContents().find((w) => w.getType() === 'webview')
      return wv ? String(await wv.executeJavaScript('document.body.innerText')) : ''
    })
  try {
    await win.waitForSelector('.app .tb')
    await win.keyboard.press('Control+Shift+P')
    await win.getByPlaceholder(/Search panes, projects/).fill('preview')
    await win.getByRole('option', { name: /Preview: open for site/ }).click()

    // First open: the command found in package.json, editable; Start saves it on the project.
    const pane = win.locator('section.pane')
    const command = pane.getByLabel('Command')
    await expect(command).toHaveValue('npm run dev')
    await expect(pane).toContainText('from package.json "dev"')
    await command.fill(`node "${SERVER}"`)
    await pane.getByRole('button', { name: 'Start' }).click()

    // The page loads from the address the server printed.
    const address = pane.getByLabel('Address')
    await expect(address).toHaveValue(/^http:\/\/127\.0\.0\.1:\d+\/$/, { timeout: 15_000 })
    await expect(pane.locator('.ph-st')).toHaveText('running')
    await expect.poll(pageText, { timeout: 15_000 }).toContain('PREVIEW OK')
    await expect.poll(() => saved().workspaces[0].preview?.command).toBe(`node "${SERVER}"`)
    const url = await address.inputValue()

    // Moving around the local site works; the address follows.
    await app.evaluate(({ webContents }) => {
      const wv = webContents.getAllWebContents().find((w) => w.getType() === 'webview')
      // As a user's click: Chromium skips script-only navigations in Back history.
      void wv?.executeJavaScript('document.getElementById("two").click()', true)
    })
    await expect.poll(pageText).toContain('PAGE TWO')
    await expect(address).toHaveValue(`${url}two`)
    await expect(pane.getByRole('button', { name: 'Back' })).toBeEnabled()

    // The server's output is in the Log drawer.
    await pane.getByRole('button', { name: 'Log' }).click()
    await expect(pane.getByRole('region', { name: 'Server log' })).toContainText('Local:')

    // Its own session: nothing shared with the app's.
    const partition = await app.evaluate(({ webContents, session }) => {
      const wv = webContents.getAllWebContents().find((w) => w.getType() === 'webview')
      return wv?.session === session.defaultSession ? 'default' : 'own'
    })
    expect(partition).toBe('own')

    // Closing the pane stops the server.
    await pane.locator('.ph').hover()
    await pane
      .getByRole('button', { name: /^Pane actions|^More$/ })
      .first()
      .click()
    await win.getByRole('menuitem', { name: 'Close pane' }).click()
    await expect(pane).toHaveCount(0)
    await expect
      .poll(
        () =>
          fetch(url).then(
            () => 'up',
            () => 'down'
          ),
        { timeout: 10_000 }
      )
      .toBe('down')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
