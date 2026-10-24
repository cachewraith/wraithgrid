// Whole-app #75 acceptance: shared surfaces, themed controls, complete navigation and no
// motion under either preference. Screenshots are opt-in, using throwaway fake-CLI data.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
test.skip(process.platform === 'win32', 'POSIX-only CLI fixture')

const fits = async (page: Page, selector: string): Promise<void> => {
  for (const el of await page.locator(selector).all()) {
    expect(await el.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true)
  }
}

for (const theme of ['wraith', 'midnight', 'clay', 'daylight', 'paper', 'community']) {
  test(`whole-app design: ${theme}, pages, controls, rail and reduced motion`, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-ui-75-'))
    const data = path.join(tmp, 'data')
    fs.mkdirSync(data)
    fs.mkdirSync(path.join(tmp, 'project'))
    if (theme === 'community') {
      fs.mkdirSync(path.join(tmp, '.wraithgrid/themes'), { recursive: true })
      fs.writeFileSync(
        path.join(tmp, '.wraithgrid/themes/community.json'),
        JSON.stringify({
          name: 'Community',
          mode: 'dark',
          colors: { bg: '#172026', sidebar: '#131b20', text: '#f0f1f2', accent: '#65bac7' },
          style: {
            radius: 'large',
            depth: 'deep',
            border: 'thick',
            density: 'spacious',
            monoFont: 'System'
          }
        })
      )
    }
    const light = theme === 'daylight' || theme === 'paper'
    fs.writeFileSync(
      path.join(data, 'config.json'),
      JSON.stringify({
        version: 1,
        claudePath: path.join(ROOT, 'tests/fixtures/fake-claude.sh'),
        accounts: [
          {
            id: 'work',
            name: 'work',
            cli: 'claude',
            configDir: '~/.wraithgrid/accounts/work',
            color: '#7c5cff',
            signedIn: true
          }
        ],
        workspaces: [
          {
            id: 'project',
            name: 'project',
            folder: '~/project',
            icon: 'mit:typescript',
            panes: [
              {
                id: 'chat',
                accountId: 'work',
                cwd: '~/project',
                title: 'Review changes',
                view: 'chat'
              }
            ],
            layout: { type: 'pane', paneId: 'chat' }
          },
          { id: 'empty', name: 'Empty project', panes: [], layout: null },
          ...Array.from({ length: 6 }, (_, i) => ({
            id: `empty-${i}`,
            name: `Empty project ${i + 2}`,
            panes: [],
            layout: null
          }))
        ],
        activeWorkspace: 'project',
        settings: {
          theme: light ? 'light' : 'dark',
          themeDark: theme,
          themeLight: theme,
          sidebarWidth: 264,
          checkUpdatesOnLaunch: false
        }
      })
    )
    const app = await electron.launch({
      args: [path.join(ROOT, 'out/main/index.js')],
      env: { ...process.env, HOME: tmp, WRAITHGRID_USER_DATA_DIR: data }
    })
    const shots = process.env.WRAITHGRID_UI_SHOTS
    const shot = async (win: Page, name: string): Promise<void> => {
      if (!shots) return
      fs.mkdirSync(shots, { recursive: true })
      await win.screenshot({
        path: path.join(shots, `${theme}-${name}.png`),
        animations: 'disabled'
      })
    }
    try {
      const win = await app.firstWindow()
      const side = win.getByRole('complementary', { name: 'Sidebar' })
      await expect(side.locator('.side-brand')).toHaveText('Wraithgrid')
      // Seven empty projects and one active project must form one compact, left-aligned list.
      await expect(side.locator('.ws-row')).toHaveCount(8)
      const rows = await side.locator('.ws-row').evaluateAll((buttons) =>
        buttons.map((button) => {
          const row = button.getBoundingClientRect()
          const project = button.closest('.proj')!.getBoundingClientRect()
          const title = button.querySelector('.ws-name')!.getBoundingClientRect()
          const empty = button.parentElement!.querySelector<HTMLButtonElement>('.ws-tg')!.disabled
          return {
            top: project.top,
            bottom: project.bottom,
            height: project.height,
            rowHeight: row.height,
            titleLeft: title.left,
            empty
          }
        })
      )
      expect(
        Math.max(...rows.map((r) => r.titleLeft)) - Math.min(...rows.map((r) => r.titleLeft))
      ).toBeLessThan(1)
      for (const row of rows.filter((r) => r.empty))
        expect(row.height).toBeLessThanOrEqual(row.rowHeight + 2)
      for (let i = 1; i < rows.length; i++)
        expect(rows[i]!.top - rows[i - 1]!.bottom).toBeLessThanOrEqual(4)

      await expect(win.locator('html')).toHaveAttribute('data-theme', light ? 'light' : 'dark')
      if (theme === 'community')
        expect(
          await win.evaluate(() => document.documentElement.style.getPropertyValue('--bg'))
        ).toBe('#172026')
      await expect(side.locator('.side-meta')).toHaveText(/1 pane\s*1 account\s*v/)
      await expect(side.locator('.side-chat .provider-logo')).toHaveCount(1)
      await expect(side.locator('.su-hd .provider-logo')).toHaveCount(1)
      await expect(win.locator('.chat-host')).toBeVisible()
      await expect(win.getByLabel('Message', { exact: true })).toHaveAttribute(
        'placeholder',
        /Message/
      )
      await win.getByLabel('Message', { exact: true }).fill('Review this change')
      await win.getByLabel('Message', { exact: true }).press('Enter')
      await expect(win.locator('.cmsg.agent')).toContainText('Review this change')
      // Opt-in comparison against the actual approved local HTML, not a recreated drawing.
      if (theme === 'wraith' && process.env.WRAITHGRID_SIDEBAR_REFERENCE) {
        await expect(side.locator('.su-win')).toHaveCount(2)
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.setSize(1200, 804)
        )
        const nextWindow = app.waitForEvent('window')
        await app.evaluate(async ({ BrowserWindow }, file) => {
          const reference = new BrowserWindow({ width: 1200, height: 1000 })
          await reference.loadFile(file)
        }, process.env.WRAITHGRID_SIDEBAR_REFERENCE)
        const reference = await nextWindow
        await reference.evaluate(() => document.fonts.ready)
        const expected = await reference.evaluate(() =>
          Object.fromEntries(
            Object.entries({
              header: '.hd',
              nav: '.nav .row',
              project: '.prow',
              chat: '.c',
              window: '.win'
            }).map(([key, selector]) => [
              key,
              document.querySelector(selector)!.getBoundingClientRect().height
            ])
          )
        )
        const actual = await side.evaluate((el) =>
          Object.fromEntries(
            Object.entries({
              header: '.side-hd',
              nav: '.nav-row',
              project: '.ws-row',
              chat: '.side-chat',
              window: '.su-win'
            }).map(([key, selector]) => [
              key,
              el.querySelector(selector)!.getBoundingClientRect().height
            ])
          )
        )
        expect(actual).toEqual(expected)
        await reference
          .locator('aside.side')
          .screenshot({ path: '/tmp/sidebar-v3-reference.png', animations: 'disabled' })
        await reference.close()
        await side.screenshot({ path: '/tmp/sidebar-expanded-fixed.png', animations: 'disabled' })
      }

      for (const selector of ['.main', '.side', '.pane.focused .ph']) {
        expect(await win.locator(selector).evaluate((n) => getComputedStyle(n).boxShadow)).toBe(
          'none'
        )
      }
      await shot(win, 'chat')
      await side.getByRole('button', { name: 'Collapse sidebar' }).click()
      await expect(side.getByRole('button', { name: 'Open project project' })).toBeVisible()
      await expect(
        side.getByRole('button', { name: 'Open project Empty project', exact: true })
      ).toBeVisible()
      await side.getByRole('button', { name: 'Open project Empty project', exact: true }).click()
      await expect(win.getByRole('heading', { name: 'Empty project', exact: true })).toBeVisible()
      await side.getByRole('button', { name: 'Expand sidebar' }).click()
      await side.locator('.ws-row', { hasText: 'project' }).filter({ hasNotText: 'Empty' }).click()
      await expect(win.locator('.pj-hd h1')).toHaveText('project')
      await fits(win, '.page, .pj')
      await shot(win, 'project')
      await side.locator('.side-use').click()
      await expect(win.getByRole('heading', { name: 'Usage', exact: true })).toBeVisible()
      await fits(win, '.page, .page-in')
      await shot(win, 'usage')
      await side.getByRole('button', { name: /Switch account/ }).click()
      await win.getByRole('menuitem', { name: 'Manage accounts' }).click()
      await expect(win.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
      await fits(win, '.page, .page-in')
      await shot(win, 'accounts')
      await side.getByRole('button', { name: /Switch account/ }).click()
      await win.getByRole('menuitem', { name: 'Mods', exact: true }).click()
      await expect(win.getByRole('heading', { name: 'Mods', exact: true })).toBeVisible()
      await fits(win, '.page, .page > .set')
      await shot(win, 'mods')
      await win.getByRole('button', { name: 'More', exact: true }).click()
      await win.getByRole('menuitem', { name: 'Settings', exact: true }).click()
      await expect(win.getByRole('tabpanel', { name: 'General', exact: true })).toBeVisible()
      await shot(win, 'settings')
      // Native select popups are replaced with a keyboard listbox, including inside scrollers.
      await win.getByRole('tab', { name: 'Appearance', exact: true }).click()
      await win.getByRole('button', { name: 'Customize…' }).click()
      const editor = win.getByRole('region', { name: 'Theme editor' })
      const font = editor.getByRole('combobox', { name: 'Font', exact: true })
      await font.click()
      await expect(win.getByRole('listbox', { name: 'Font', exact: true })).toBeVisible()
      await win.getByRole('option', { name: 'System', exact: true }).click()
      await expect(font).toHaveText('System')
      await font.press('Enter')
      await font.press('Home')
      await font.press('Enter')
      await expect(font).toHaveText('Geist')
      await font.press('Enter')
      await font.press('Escape')
      await expect(font).toBeFocused()
      await expect(editor).toBeVisible()
      await expect(win.locator('select')).toHaveCount(0)
      // The OS and application preferences both disable transitions as well as animations.
      await editor
        .getByRole('radiogroup', { name: 'Motion' })
        .getByRole('radio', { name: 'Reduced' })
        .click()
      await expect(win.locator('html')).toHaveAttribute('data-motion', 'reduced')
      const motion = () =>
        win.locator('.set').evaluate((n) => ({
          animation: getComputedStyle(n).animationName,
          transition: getComputedStyle(document.querySelector('.btn')!).transitionDuration,
          scroll: getComputedStyle(n).scrollBehavior
        }))
      await expect.poll(motion).toEqual({ animation: 'none', transition: '0s', scroll: 'auto' })
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
      await win.emulateMedia({ reducedMotion: 'reduce' })
      await expect.poll(motion).toEqual({ animation: 'none', transition: '0s', scroll: 'auto' })
      await win.emulateMedia({ reducedMotion: 'no-preference' })
      // Arrow keys move between linked settings tabs, including the remounted reading panel.
      await win.getByRole('tab', { name: 'General', exact: true }).click()
      await win.getByRole('tab', { name: 'General', exact: true }).press('ArrowDown')
      await expect(win.getByRole('tabpanel', { name: 'Chat', exact: true })).toBeVisible()
      for (const name of ['Agents & CLIs', 'Advanced', 'Keyboard', 'About']) {
        await win.getByRole('tab', { name, exact: true }).click()
        await fits(win, '.set')
      }
      await side.locator('.ws-row', { hasText: 'project' }).filter({ hasNotText: 'Empty' }).click()
      await win.getByRole('button', { name: 'New chat in project', exact: true }).click()
      await expect(win.getByRole('dialog')).toBeVisible()
      await shot(win, 'dialog')
      await win.keyboard.press('Escape')
      await side.locator('.nav-row').filter({ hasText: 'Search' }).click()
      await expect(win.getByRole('dialog', { name: 'Search panes and commands' })).toBeVisible()
      await shot(win, 'palette')
      await win.keyboard.press('Escape')
      await side.getByRole('button', { name: /Switch account/ }).click()
      await shot(win, 'menu')
      await win.keyboard.press('Escape')
      await win
        .getByRole('button', { name: /Open.*Review changes|Review changes/ })
        .first()
        .click()
      await win.getByRole('button', { name: 'Terminal', exact: true }).click()
      await expect(win.locator('.term-host')).toBeVisible()
      await shot(win, 'terminal')
    } finally {
      await app.close()
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
}
