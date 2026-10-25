import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')

const resize = (app: ElectronApplication, w: number, h: number) =>
  app.evaluate(
    ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setSize(s[0]!, s[1]!),
    [w, h]
  )

test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('app zoom keys, and the layout adapts to a small window', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-responsive-'))
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(path.join(tmp, 'a'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'b'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  const configFile = path.join(userData, 'config.json')
  const saved = () => JSON.parse(fs.readFileSync(configFile, 'utf8')).settings
  const pane = (id: string, cwd: string) => ({
    id,
    accountId: 'a-work',
    cwd,
    title: `pane-${id}`,
    view: 'terminal'
  })
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      version: 1,
      claudePath: FAKE_CLAUDE,
      accounts: [
        {
          id: 'a-work',
          name: 'work-account',
          configDir: '~/.wraithgrid/accounts/work',
          color: '#7c5cff',
          signedIn: true,
          imported: false
        }
      ],
      workspaces: [
        {
          id: 'ws-main',
          name: 'main',
          panes: [pane('p1', path.join(tmp, 'a')), pane('p2', path.join(tmp, 'b'))],
          layout: {
            type: 'split',
            dir: 'row',
            sizes: [50, 50],
            children: [
              { type: 'pane', paneId: 'p1' },
              { type: 'pane', paneId: 'p2' }
            ]
          }
        }
      ],
      activeWorkspace: 'ws-main',
      recentFolders: [],
      settings: { checkUpdatesOnLaunch: false }
    })
  )

  const app = await electron.launch({
    args: [MAIN],
    cwd: tmp,
    env: { ...process.env, HOME: tmp, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    const zoom = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor()
      )
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())
    ).toEqual([640, 420])
    await expect(win.locator('section.pane')).toHaveCount(2)

    // ---- Ctrl+= / Ctrl+- / Ctrl+0 zoom the whole app, with a short badge, and persist.
    await win.keyboard.press('Control+Equal')
    await expect(win.locator('.zoom-badge')).toHaveText('110%')
    await expect.poll(zoom).toBeCloseTo(1.1)
    await win.keyboard.press('Control+Equal')
    await expect.poll(zoom).toBeCloseTo(1.25)
    await win.keyboard.press('Control+Minus')
    await expect.poll(zoom).toBeCloseTo(1.1)
    await expect.poll(() => saved().uiZoom).toBe(1.1)
    await win.keyboard.press('Control+0')
    await expect.poll(zoom).toBeCloseTo(1)
    await expect.poll(() => saved().uiZoom).toBe(1)

    // ---- A narrow window: the sidebar becomes the rail without changing the saved choice.
    await resize(app, 1300, 800)
    await expect(side).not.toHaveClass(/\bcol\b/)
    await resize(app, 700, 520)
    await expect(side).toHaveClass(/\bcol\b/)
    expect(saved().sidebarCollapsed).toBe(false)
    // Expanding opens a drawer over the content; Escape closes it.
    await win.getByRole('button', { name: 'Expand sidebar' }).click()
    await expect(side).toHaveClass(/\bdrawer\b/)
    await expect(side.getByText('Projects')).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(side).toHaveClass(/\bcol\b/)
    expect(saved().sidebarCollapsed).toBe(false)

    // Pane headers keep the title and the ⋯ button inside the pane (#89).
    for (const p of await win.locator('section.pane').all()) {
      const box = (await p.boundingBox())!
      const more = (await p.locator('.ph-more').boundingBox())!
      expect(more.x + more.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
      await expect(p.locator('.ph-title')).toBeVisible()
    }

    // Settings: tabs on top, one column, nothing wider than the panel.
    await win.getByRole('button', { name: 'More' }).click()
    await win.getByRole('menuitem', { name: 'Settings' }).click()
    await win.getByRole('tab', { name: 'Appearance' }).click()
    const overflow = await win.evaluate(() => {
      const e = document.querySelector('.set-page .set')!
      return e.scrollWidth - e.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(win.locator('.set-nav h1')).toBeHidden()

    // Back to a wide window: the saved (expanded) sidebar returns.
    await resize(app, 1300, 800)
    await expect(side).not.toHaveClass(/\bcol\b/)
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
