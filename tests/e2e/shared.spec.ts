import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')

test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('overall mode links every account to ~/.claude', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-shared-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  const personal = path.join(home, '.claude') // the machine's own claude setup
  const work = path.join(home, '.wraithgrid/accounts/work')
  const late = path.join(home, '.wraithgrid/accounts/late')
  fs.mkdirSync(path.join(personal, 'skills', 'deploy'), { recursive: true })
  fs.writeFileSync(path.join(personal, 'CLAUDE.md'), '# one set of rules\n')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, 'CLAUDE.md'), '# work only\n')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  const account = (id: string, name: string, dir: string, color: string) => ({
    id,
    name,
    configDir: dir,
    color,
    signedIn: true,
    imported: false
  })
  fs.writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: FAKE_CLAUDE,
      accounts: [account('a-work', 'work', '~/.wraithgrid/accounts/work', '#2dd4bf')],
      workspaces: [{ id: 'ws', name: 'main', panes: [], layout: null }],
      activeWorkspace: 'ws',
      recentFolders: [],
      settings: { sharedMode: 'per-account' }
    })
  )

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    await win.getByRole('button', { name: 'Settings' }).click()
    const group = win.getByRole('radiogroup', { name: 'Shared CLAUDE.md and skills' })

    // Overall: work links to ~/.claude, and its own file is kept aside.
    await group.getByRole('radio', { name: /^Overall/ }).click()
    // "work: " is the report line; a bare "work" also matches CI paths like /home/runner/work.
    await expect(win.getByRole('status').filter({ hasText: 'work: ' })).toContainText(
      'kept the old one'
    )
    expect(fs.readlinkSync(path.join(work, 'CLAUDE.md'))).toBe(path.join(personal, 'CLAUDE.md'))
    expect(fs.readFileSync(path.join(work, 'CLAUDE.md'), 'utf8')).toBe('# one set of rules\n')
    expect(fs.existsSync(path.join(work, 'skills', 'deploy'))).toBe(true)
    expect(fs.readlinkSync(path.join(work, 'plugins'))).toBe(path.join(personal, 'plugins'))
    expect(fs.readFileSync(path.join(work, 'CLAUDE.md.wraithgrid-backup'), 'utf8')).toBe(
      '# work only\n'
    )

    // An account added later is linked as soon as a pane starts for it.
    await win.locator('.top .btn.gh').click()
    await win.getByRole('button', { name: 'New account' }).click()
    await win.locator('#acc-name').fill('late')
    await win.getByRole('button', { name: 'Add account', exact: true }).last().click()
    await win.locator('.tr', { hasText: 'late' }).getByRole('button', { name: 'Login' }).click()
    await expect
      .poll(
        () =>
          fs.existsSync(path.join(late, 'CLAUDE.md')) &&
          fs.readlinkSync(path.join(late, 'CLAUDE.md'))
      )
      .toBe(path.join(personal, 'CLAUDE.md'))

    // Each account its own: links go, and work gets its own CLAUDE.md back.
    await win.getByRole('button', { name: 'Settings' }).click()
    await group.getByRole('radio', { name: 'Each account its own' }).click()
    await expect.poll(() => fs.lstatSync(path.join(work, 'CLAUDE.md')).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(path.join(work, 'CLAUDE.md'), 'utf8')).toBe('# work only\n')
    expect(fs.existsSync(path.join(work, 'skills'))).toBe(false)
    expect(fs.existsSync(path.join(late, 'CLAUDE.md'))).toBe(false)
    expect(fs.readFileSync(path.join(personal, 'CLAUDE.md'), 'utf8')).toBe('# one set of rules\n')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
