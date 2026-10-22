import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')

test('after an update: "Updated to" once, What’s new in About, earlier versions kept', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-about-'))
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
      workspaces: [{ id: 'ws-a', name: 'alpha', panes: [], layout: null }],
      activeWorkspace: 'ws-a',
      recentFolders: [],
      settings: { checkUpdatesOnLaunch: false }
    })
  )
  // An older version ran last and saved notes a check found back then.
  const notesFile = path.join(userData, 'release-notes.json')
  fs.writeFileSync(
    notesFile,
    JSON.stringify({
      lastRun: '0.9.0',
      saved: [{ version: '0.9.5', title: '', date: null, notes: 'Saved **from GitHub**.' }]
    })
  )
  const launch = () =>
    electron.launch({
      args: [MAIN],
      env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
    })

  let app = await launch()
  try {
    const win = await app.firstWindow()
    // Unpackaged, the app reports Electron's version: newer than every bundled note.
    const version = await app.evaluate(({ app }) => app.getVersion())
    const notice = win.getByRole('button', { name: `Updated to ${version} · See what’s new` })
    await expect(notice).toBeVisible()
    await notice.click()
    await expect(notice).toHaveCount(0)

    // About: the update state, then What's new.
    const updates = win.locator('#updates')
    await expect(updates).toHaveAttribute('data-state', 'unchecked')
    await expect(updates.getByRole('status')).toHaveText('Not checked yet.')
    const wn = win.locator('#whats-new')
    await expect(wn.getByRole('heading', { name: `What’s new in ${version}` })).toBeVisible()
    await expect(wn).toContainText('No notes for this version.')

    // Earlier versions: collapsed, as markdown (the bundled WHATS-NEW has tables), and the
    // notes saved from GitHub.
    const earlier = wn.getByLabel('Earlier versions')
    const bundled = earlier.locator('details').first()
    await expect(bundled).not.toHaveAttribute('open')
    await bundled.locator('summary').click()
    await expect(bundled.getByRole('table').first()).toBeVisible()
    const old = earlier.locator('details', { hasText: '0.9.5' })
    await old.locator('summary').click()
    await expect(old.locator('strong')).toHaveText('from GitHub')

    await expect.poll(() => JSON.parse(fs.readFileSync(notesFile, 'utf8')).lastRun).toBe(version)
  } finally {
    await app.close()
  }

  // Next start: no notice again.
  app = await launch()
  try {
    const win = await app.firstWindow()
    await win.waitForSelector('.app .tb')
    await expect(win.getByRole('button', { name: /^Updated to/ })).toHaveCount(0)
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
