import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')

// Uses a bash stand-in for claude; Windows is covered by unit tests.
test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('mods: panes load mod folders; the view lists, toggles and installs for every account', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-mods-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  const accountDir = path.join(home, '.wraithgrid', 'accounts', 'personal')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  // A downloaded mod: a clone of a local origin that gets a new commit after the download.
  const origin = path.join(tmp, 'meter-origin')
  const meter = path.join(home, '.wraithgrid', 'mods', 'meter')
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd }).toString()
  fs.mkdirSync(path.join(origin, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(origin, '.claude-plugin', 'plugin.json'), '{"name":"meter"}')
  git(origin, 'init', '-q')
  git(origin, 'add', '.')
  git(origin, 'commit', '-qm', 'one')
  fs.mkdirSync(path.dirname(meter), { recursive: true })
  git(tmp, 'clone', '-q', origin, meter)
  fs.writeFileSync(path.join(origin, 'README.md'), 'two')
  git(origin, 'add', '.')
  git(origin, 'commit', '-qm', 'two')
  const cfgFile = path.join(userData, 'config.json')
  fs.writeFileSync(
    cfgFile,
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
        },
        {
          id: 'a-work',
          name: 'work',
          configDir: '~/.wraithgrid/accounts/work',
          color: '#22a06b',
          signedIn: true,
          imported: false
        }
      ],
      workspaces: [
        {
          id: 'ws-a',
          name: 'alpha',
          panes: [{ id: 'p-1', accountId: 'a-personal', cwd: '~/proj', title: 'proj' }],
          layout: null
        }
      ],
      activeWorkspace: 'ws-a',
      recentFolders: [],
      settings: { sharedMode: 'per-account', modDirs: ['~/mods/tally', '~/.wraithgrid/mods/meter'] }
    })
  )
  // Written after a debounce: tolerate a missing or half-written file.
  const saved = (): { settings: { modDirs: string[]; gpuTerminal: boolean } } | null => {
    try {
      return JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
    } catch {
      return null
    }
  }
  const callsOf = (dir: string) => (): string => {
    try {
      return fs.readFileSync(path.join(dir, 'plugin-calls.log'), 'utf8')
    } catch {
      return ''
    }
  }
  const calls = callsOf(accountDir)
  const workCalls = callsOf(path.join(home, '.wraithgrid', 'accounts', 'work'))

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()

    // The pane's claude was given the mod folder as an absolute path.
    await expect
      .poll(async () =>
        (await win.locator('section.pane .xterm-rows').innerText()).replace(/\s+/g, '')
      )
      .toContain(`PLUGIN_DIRS=${path.join(home, 'mods', 'tally')}`)

    await win.getByRole('button', { name: 'Mods', exact: true }).click()
    await expect(win.getByRole('heading', { name: 'Mods', level: 1 })).toBeVisible()

    // The accounts' own `claude plugin list --json`, shown as one list with one switch per mod.
    const tally = win.getByRole('switch', { name: 'tally enabled' })
    await expect(tally).toHaveCount(1)
    await expect(tally).toHaveAttribute('aria-checked', 'true')
    await expect(win.getByText('acme · user · all 2 accounts').first()).toBeVisible()
    // A mod's name opens the repository of the marketplace it came from.
    await expect(win.getByRole('button', { name: 'Open the repository of tally' })).toHaveAttribute(
      'title',
      'https://github.com/acme/mods'
    )
    await expect(win.getByRole('switch', { name: 'broken enabled' })).toHaveAttribute(
      'aria-checked',
      'false'
    )

    await tally.click()
    await expect(tally).toHaveAttribute('aria-checked', 'false')
    await expect.poll(calls).toContain('plugin disable tally@acme --scope user')
    await expect.poll(workCalls).toContain('plugin disable tally@acme --scope user')
    await expect(win.getByRole('button', { name: 'Restart claude panes' })).toBeVisible()

    // A refresh asks claude again and shows what it now reports.
    await win.getByRole('button', { name: 'Refresh' }).click()
    await expect(tally).toHaveAttribute('aria-checked', 'false')

    // claude's own error is shown and the switch stays as it was.
    await win.getByRole('switch', { name: 'broken enabled' }).click()
    await expect(win.getByText('personal: Plugin broken@acme could not be loaded')).toBeVisible()
    await expect(win.getByRole('switch', { name: 'broken enabled' })).toHaveAttribute(
      'aria-checked',
      'false'
    )

    // Browse: one catalog, one row per mod; an install reaches every account, adding the
    // marketplace to the account that lacks it.
    const search = win.getByPlaceholder('Search mods by name or what they do')
    await expect(win.getByText('2 mods, most installed first')).toBeVisible()
    await search.fill('clock')
    await expect(win.getByText('1 mod found')).toBeVisible()
    await win.getByRole('button', { name: 'Install clock', exact: true }).click()
    await expect.poll(calls).toContain('plugin install clock@acme --scope user')
    await expect.poll(workCalls).toContain('plugin marketplace add acme/mods')
    await expect.poll(workCalls).toContain('plugin install clock@acme --scope user')
    await expect(win.getByText('acme · user · all 2 accounts')).toHaveCount(3)
    if (process.env.WRAITHGRID_E2E_SHOTS)
      await win.screenshot({ path: path.join(process.env.WRAITHGRID_E2E_SHOTS, 'mods.png') })
    await expect(win.getByRole('switch', { name: 'clock enabled' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await expect(win.getByRole('button', { name: 'Install clock', exact: true })).toHaveCount(0)

    // Update and uninstall reach every account that has the mod; uninstall asks twice.
    await win.getByRole('button', { name: 'Update clock' }).click()
    await expect.poll(calls).toContain('plugin update clock@acme --scope user')
    await expect.poll(workCalls).toContain('plugin update clock@acme --scope user')
    await win.getByRole('button', { name: 'Uninstall clock' }).click()
    await win.getByRole('button', { name: 'Confirm uninstall clock' }).click()
    await expect.poll(calls).toContain('plugin uninstall clock@acme --scope user')
    await expect.poll(workCalls).toContain('plugin uninstall clock@acme --scope user')
    await expect(win.getByRole('switch', { name: 'clock enabled' })).toHaveCount(0)

    // Marketplaces: one list for all accounts; add and remove go to each of them.
    const markets = win.getByRole('list', { name: 'Marketplaces' })
    await expect(markets.getByText('all 2 accounts')).toBeVisible()
    await win.getByRole('textbox', { name: 'Marketplace to add' }).fill('acme/extra')
    await win.getByRole('button', { name: 'Add marketplace' }).click()
    await expect.poll(calls).toContain('plugin marketplace add acme/extra')
    await expect.poll(workCalls).toContain('plugin marketplace add acme/extra')
    await win.getByRole('button', { name: 'Remove marketplace acme' }).click()
    await win.getByRole('button', { name: 'Confirm remove acme' }).click()
    await expect.poll(workCalls).toContain('plugin marketplace remove acme')

    // GPU drawing is a saved setting; the pane keeps a screen either way.
    await win.getByRole('switch', { name: 'Draw panes with the GPU' }).click()
    await expect.poll(() => saved()?.settings.gpuTerminal).toBe(true)

    // A downloaded mod updates from its repository; a folder of the user's own has no Update.
    const folders = win.getByRole('list', { name: 'Mod folders' })
    await expect(folders.getByRole('button', { name: /^Update / })).toHaveCount(1)
    await folders.getByRole('button', { name: 'Update meter' }).click()
    await expect(folders.getByRole('status').filter({ hasText: 'Updated' })).toBeVisible()
    expect(fs.readFileSync(path.join(meter, 'README.md'), 'utf8')).toBe('two')
    await folders.getByRole('button', { name: 'Update meter' }).click()
    await expect(folders.getByRole('status').filter({ hasText: 'Up to date' })).toBeVisible()

    await win.getByRole('button', { name: 'Remove ~/mods/tally' }).click()
    await win.getByRole('button', { name: 'Remove ~/.wraithgrid/mods/meter' }).click()
    await expect.poll(() => saved()?.settings.modDirs).toEqual([])

    await win.locator('header.top .btn', { hasText: 'alpha' }).click()
    await expect(win.locator('section.pane .xterm-screen')).toBeVisible()
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
