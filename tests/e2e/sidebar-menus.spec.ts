import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')

test('right-click edits folders and workspaces; the sidebar collapses smoothly', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-menus-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  const cfgFile = path.join(userData, 'config.json')
  fs.writeFileSync(
    cfgFile,
    JSON.stringify({
      version: 1,
      claudePath: '',
      accounts: [],
      accountFolders: [{ id: 'f-one', name: 'Folder 1', collapsed: false }],
      workspaces: [
        { id: 'ws-a', name: 'alpha', panes: [], layout: null },
        { id: 'ws-b', name: 'beta', panes: [], layout: null }
      ],
      activeWorkspace: 'ws-a',
      recentFolders: [],
      settings: { sharedMode: 'per-account' }
    })
  )
  const saved = () => JSON.parse(fs.readFileSync(cfgFile, 'utf8'))

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    const side = win.getByRole('complementary', { name: 'Sidebar' })

    // Folder (on the Accounts page): rename from the menu.
    await side.getByRole('button', { name: /Switch account/ }).click()
    await win.getByRole('menuitem', { name: 'Manage accounts' }).click()
    const org = win.getByLabel('Account folders')
    await org.locator('.fold-hd', { hasText: 'Folder 1' }).click({ button: 'right' })
    const folderMenu = win.getByRole('menu', { name: 'Folder Folder 1' })
    await expect(folderMenu.getByRole('menuitem').first()).toBeFocused()
    await folderMenu.getByRole('menuitem', { name: 'Rename' }).click()
    await org.getByLabel('Folder name').fill('Clients')
    await org.getByLabel('Folder name').press('Enter')
    await expect.poll(() => saved().accountFolders[0].name).toBe('Clients')

    // Escape closes a menu without doing anything.
    await org.locator('.fold-hd', { hasText: 'Clients' }).click({ button: 'right' })
    await win.keyboard.press('Escape')
    await expect(win.getByRole('menu')).toHaveCount(0)

    // Workspace: rename (no icon to change), then a two-step delete.
    const beta = side.locator('.ws-row', { hasText: 'beta' })
    await beta.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Rename' }).click()
    await side.getByLabel('Workspace name').fill('review')
    await side.getByLabel('Workspace name').press('Enter')
    await expect.poll(() => saved().workspaces[1].name).toBe('review')

    const review = side.locator('.ws-row', { hasText: 'review' })
    await review.click({ button: 'right' })
    await expect(win.getByRole('menuitem', { name: 'Change icon' })).toHaveCount(0)
    await win.keyboard.press('Escape')

    await review.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Delete workspace' }).click()
    // First click only arms it.
    expect(saved().workspaces).toHaveLength(2)
    await win.getByRole('menuitem', { name: 'Click again to delete' }).click()
    await expect.poll(() => saved().workspaces.length).toBe(1)

    // The last workspace can't be deleted.
    await side.locator('.ws-row', { hasText: 'alpha' }).click({ button: 'right' })
    await expect(win.getByRole('menuitem', { name: 'Delete (last workspace)' })).toBeDisabled()
    await win.keyboard.press('Escape')

    // Collapse animates the width instead of jumping, then settles at the rail width.
    await side.getByRole('button', { name: 'Collapse sidebar' }).click()
    const midWidth = await side.evaluate((el) => el.getBoundingClientRect().width)
    expect(midWidth).toBeGreaterThan(52)
    await expect.poll(() => side.evaluate((el) => el.getBoundingClientRect().width)).toBe(52)
    await expect(side).not.toHaveClass(/moving/)
  } finally {
    await app.close()
  }
})

test('sidebar focus is an inset ring for keyboard only; no endless motion', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-focus-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: '',
      accounts: [],
      workspaces: [
        { id: 'ws-a', name: 'alpha', panes: [], layout: null },
        { id: 'ws-b', name: 'beta', panes: [], layout: null }
      ],
      activeWorkspace: 'ws-a',
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
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    const beta = side.locator('.ws-row', { hasText: 'beta' })
    const ring = (el: Element) => {
      const cs = getComputedStyle(el)
      return { outline: cs.outlineStyle, shadow: cs.boxShadow }
    }

    // A click selects without a focus ring.
    await beta.click()
    expect(await beta.evaluate(ring)).toMatchObject({ outline: 'none', shadow: 'none' })

    // Keyboard focus: an inset ring inside the row, no outline sticking out.
    await beta.focus()
    await win.keyboard.press('Shift+Tab')
    await win.keyboard.press('Tab')
    await expect(beta).toBeFocused()
    const focused = await beta.evaluate(ring)
    expect(focused.outline).toBe('none')
    expect(focused.shadow).toContain('inset')

    // Nothing in the sidebar animates forever, and nothing overshoots.
    const endless = await side.evaluate(
      (el) =>
        [el, ...el.querySelectorAll('*')].filter((n) => {
          const cs = getComputedStyle(n)
          return cs.animationIterationCount === 'infinite' && cs.animationName !== 'none'
        }).length
    )
    expect(endless).toBe(0)
    const ind = await side.locator('.side-ind').evaluate((el) => getComputedStyle(el).transition)
    expect(ind).not.toContain('1.4')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
