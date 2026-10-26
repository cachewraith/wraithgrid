import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')

test('after an update: "Updated to" once, What’s new in About, earlier versions kept (#124)', async () => {
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
  // The saved note must remain among the ten newest earlier versions as bundled notes grow.
  // Unpackaged Electron reports its own (newer) version, so the next application patch is
  // an earlier note there, above the bundle's latest entry, rather than a pruned 0.x fixture.
  const appVersion = (
    JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }
  ).version
  const [major, minor, patch] = appVersion.split('.')
  const savedVersion = `${major}.${minor}.${Number.parseInt(patch!, 10) + 1}`
  const notesFile = path.join(userData, 'release-notes.json')
  fs.writeFileSync(
    notesFile,
    JSON.stringify({
      lastRun: '0.9.0',
      saved: [{ version: savedVersion, title: '', date: null, notes: 'Saved **from GitHub**.' }]
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
    await expect(wn.getByRole('heading', { name: 'What’s new' })).toBeVisible()
    // The installed version is selected first and says when it has no notes.
    const versions = wn.getByRole('navigation', { name: 'Versions' })
    const pick = (v: string) =>
      versions.getByRole('button', { name: new RegExp(`^${v.replace(/\./g, '\\.')}\\b`) })
    await expect(pick(version)).toHaveAttribute('aria-current', 'true')
    await expect(pick(version)).toContainText('installed')
    await expect(wn.getByRole('article', { name: `Release notes for ${version}` })).toContainText(
      'No notes for this version.'
    )

    // A bundled version (#124): New as cards and Fixed as a list, never as tables.
    await pick(appVersion).click()
    const bundled = wn.getByRole('article', { name: `Release notes for ${appVersion}` })
    await expect(bundled).toBeVisible()
    await expect(wn.locator('.ab-card, .ab-fixes li').first()).toBeVisible()
    await expect(wn.getByRole('table')).toHaveCount(0)
    // Names keep their own line: a card title is never broken mid-word.
    const title = wn.locator('.ab-card h5, .ab-fixes li b').first()
    expect(await title.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true)
    // Notes saved from GitHub render as markdown.
    await pick(savedVersion).click()
    const old = wn.getByRole('article', { name: `Release notes for ${savedVersion}` })
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
