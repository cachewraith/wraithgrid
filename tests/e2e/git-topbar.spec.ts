// #162: the top bar's Git button follows the focused pane, and each pane can run on a branch of
// its own (a git worktree) without moving the other panes on the same folder.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
test.skip(process.platform === 'win32', 'POSIX-only fixture')

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t'
    }
  })

const chatPane = (id: string, title: string, cwd: string) => ({
  id,
  accountId: 'work',
  cwd,
  args: [],
  shell: false,
  title,
  view: 'chat'
})

test('Git button: follows the focus, its menu, worktree panes on new and existing branches', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-gittop-'))
  const home = path.join(tmp, 'home')
  const data = path.join(tmp, 'data')
  const repo = path.join(home, 'proj', 'api')
  fs.mkdirSync(repo, { recursive: true })
  fs.mkdirSync(path.join(home, 'notes'), { recursive: true })
  fs.mkdirSync(data)
  fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = t\n\temail = t@t\n')
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
  git(repo, 'branch', 'feature-x')
  git(repo, 'branch', 'older')
  git(repo, 'branch', 'older2')
  const bare = path.join(tmp, 'origin.git')
  git(tmp, 'init', '-q', '--bare', bare)
  git(repo, 'remote', 'add', 'origin', bare)
  git(repo, 'push', '-q', 'origin', 'main:refs/heads/remote-y')
  git(repo, 'fetch', '-q', 'origin')

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
          id: 'ws',
          name: 'project',
          folder: '~/proj/api',
          panes: [
            chatPane('p-one', 'one', '~/proj/api'),
            chatPane('p-two', 'two', '~/proj/api'),
            chatPane('p-notes', 'notes', '~/notes')
          ],
          layout: null
        }
      ],
      activeWorkspace: 'ws',
      recentFolders: [],
      settings: { checkUpdatesOnLaunch: false }
    })
  )
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: data }
  })
  try {
    const win = await app.firstWindow()
    await win.setViewportSize({ width: 1440, height: 860 })
    const top = win.locator('header.top')
    const gitBtn = top.getByRole('button', { name: /^Git: / })
    const paneTitled = (t: string) =>
      win.locator('section.pane', { has: win.locator('.ph-title', { hasText: t }) })
    const focus = async (t: string): Promise<void> => {
      await paneTitled(t).locator('.ph-title').click()
      await expect(win.locator('section.pane.focused .ph-title')).toHaveText(t)
    }
    const menuItem = (name: string | RegExp) => win.getByRole('menuitem', { name })

    // ---- In sight without a menu, following the focused pane; hidden outside a repo.
    await focus('one')
    await expect(gitBtn).toHaveText('main')
    fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 2\n')
    await expect(gitBtn).toHaveText('main· 1', { timeout: 15_000 })
    await expect(gitBtn).toHaveAccessibleName('Git: main, 1 changed')
    await focus('notes')
    await expect(gitBtn).toHaveCount(0)
    await focus('one')

    // ---- The menu: changes, commit / pull / push through the Changes panel's confirms.
    await gitBtn.click()
    for (const name of [
      /^Show changes/,
      'Commit…',
      'Pull',
      'Push',
      'Switch branch…',
      /^New pane on a new branch…/,
      'Open a branch in a new pane…'
    ])
      await expect(menuItem(name)).toBeVisible()
    await menuItem('Commit…').click()
    const panel = win.getByRole('complementary', { name: 'Changes' })
    await expect(win.getByLabel('Commit message')).toBeFocused()
    await gitBtn.click()
    await menuItem('Push').click()
    await expect(panel.getByText('Push main to its remote?')).toBeVisible()
    await panel.getByRole('button', { name: 'Cancel' }).click()
    await win.keyboard.press('Control+Shift+D')
    await expect(win.getByLabel('Commit message')).toHaveCount(0)

    // ---- An existing branch in a new pane: this folder stays on main.
    await gitBtn.click()
    await menuItem('Open a branch in a new pane…').click()
    const opener = win.getByRole('dialog', { name: 'Open a branch of one in a new pane' })
    // The checked-out branch isn't offered; the others are, remote ones too.
    await expect(opener.getByRole('option', { name: /^main/ })).toHaveCount(0)
    await expect(opener.getByRole('option', { name: /origin\/remote-y/ })).toBeVisible()
    await opener.getByRole('option', { name: /^feature-x/ }).click()
    await expect(opener).toHaveCount(0)
    await expect(win.locator('section.pane.focused .ph-title')).toHaveText('feature-x')
    await expect(gitBtn).toHaveText('feature-x')
    const fx = path.join(home, '.wraithgrid', 'worktrees', 'api', 'feature-x')
    expect(git(fx, 'branch', '--show-current').trim()).toBe('feature-x')
    expect(git(repo, 'branch', '--show-current').trim()).toBe('main')

    // A remote branch: a local one tracking it, in its own folder.
    await gitBtn.click()
    await menuItem('Open a branch in a new pane…').click()
    await win.getByRole('option', { name: /origin\/remote-y/ }).click()
    await expect(gitBtn).toHaveText('remote-y')
    const ry = path.join(home, '.wraithgrid', 'worktrees', 'api', 'remote-y')
    expect(git(ry, 'rev-parse', '--abbrev-ref', '@{u}').trim()).toBe('origin/remote-y')

    // Already open in another folder: said plainly, nothing created.
    await focus('one')
    await gitBtn.click()
    await menuItem('Open a branch in a new pane…').click()
    const again = win.getByRole('dialog', { name: 'Open a branch of one in a new pane' })
    await again.getByRole('option', { name: /^feature-x/ }).click()
    await expect(again.getByRole('alert')).toContainText(
      /feature-x is already checked out in .*feature-x\. A branch can be open in one folder/
    )
    await win.keyboard.press('Escape')
    await expect(again).toHaveCount(0)

    // ---- New pane on a new branch: 2 clicks and Enter (the name is suggested).
    await gitBtn.click()
    await menuItem(/^New pane on a new branch…/).click()
    const dlg = win.getByRole('dialog', { name: 'New pane on a new branch' })
    await expect(
      dlg.getByRole('switch', { name: 'Work on a new branch (git worktree)' })
    ).toHaveAttribute('aria-checked', 'true')
    await expect(dlg.locator('#np-branch')).toHaveValue(/^task-\d{4}-\d{4}$/)
    await dlg.locator('#np-branch').fill('task-a')
    await dlg.locator('#np-branch').press('Enter')
    await expect(dlg).toHaveCount(0)
    await expect(gitBtn).toHaveText('task-a')
    expect(git(repo, 'branch', '--show-current').trim()).toBe('main')

    // ---- Switch branch where another pane shares the folder: asked first.
    await focus('one')
    await gitBtn.click()
    await menuItem('Switch branch…').click()
    const picker = win.getByRole('dialog', { name: 'Switch branch of one' })
    await picker.getByRole('textbox', { name: 'Find or create a branch' }).fill('older')
    await picker.getByRole('option', { name: /^older\b/ }).click()
    const ask = picker.getByRole('alert')
    await expect(ask).toContainText('1 other pane uses this folder')
    // The safe choice has the focus: Enter opens it in a new pane, this folder stays.
    await expect(picker.getByRole('button', { name: 'Open in a new pane' })).toBeFocused()
    await win.keyboard.press('Enter')
    await expect(picker).toHaveCount(0)
    await expect(gitBtn).toHaveText('older')
    expect(git(repo, 'branch', '--show-current').trim()).toBe('main')
    // Or move them all, knowingly.
    await focus('two')
    await gitBtn.click()
    await menuItem('Switch branch…').click()
    const picker2 = win.getByRole('dialog', { name: 'Switch branch of two' })
    await picker2.getByRole('textbox', { name: 'Find or create a branch' }).fill('older2')
    await win.keyboard.press('Enter')
    await picker2.getByRole('button', { name: 'Switch all 2' }).click()
    await expect(picker2).toHaveCount(0)
    expect(git(repo, 'branch', '--show-current').trim()).toBe('older2')
    await expect(gitBtn).toHaveText('older2· 1')
    await focus('one')
    await expect(gitBtn).toHaveText('older2· 1')

    // ---- The palette has the same entries.
    await win.keyboard.press('Control+Shift+P')
    await win.getByRole('textbox', { name: 'Search' }).fill('new branch')
    await expect(win.locator('.cp-row', { hasText: 'New pane on a new branch…' })).toBeVisible()
    await win.keyboard.press('Escape')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('the worktree switch is remembered per project (#162)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-gitdef-'))
  const home = path.join(tmp, 'home')
  const data = path.join(tmp, 'data')
  const repo = path.join(home, 'proj', 'api')
  fs.mkdirSync(repo, { recursive: true })
  fs.mkdirSync(data)
  fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = t\n\temail = t@t\n')
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'a.ts'), 'x\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
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
          id: 'ws',
          name: 'project',
          folder: '~/proj/api',
          panes: [chatPane('p-one', 'one', '~/proj/api')],
          layout: { type: 'pane', paneId: 'p-one' }
        }
      ],
      activeWorkspace: 'ws',
      recentFolders: [],
      settings: { checkUpdatesOnLaunch: false }
    })
  )
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: data }
  })
  try {
    const win = await app.firstWindow()
    const newPane = async (): Promise<void> => {
      await win.keyboard.press('Control+Shift+N')
      await expect(win.getByRole('dialog', { name: 'New chat' })).toBeVisible()
    }
    const sw = win.getByRole('switch', { name: 'Work on a new branch (git worktree)' })
    // One pane on screen: its header is the top row, and the Git button is in it.
    await expect(win.getByRole('button', { name: /^Git: main/ })).toBeVisible()

    await newPane()
    await win.getByRole('button', { name: 'More options' }).click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await sw.click()
    await expect(win.locator('#np-branch')).toHaveValue(/^task-/)
    await win.locator('#np-branch').fill('first')
    await win.locator('#np-branch').press('Enter')
    await expect(win.getByRole('dialog')).toHaveCount(0)
    await expect
      .poll(() => {
        try {
          const c = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'))
          return c.workspaces[0].worktreePanes
        } catch {
          return null
        }
      })
      .toBe(true)

    // The next New chat starts on a branch of its own, with a name ready: Enter is enough.
    await newPane()
    await expect(win.locator('.np-more-on')).toHaveText('worktree')
    await win.getByRole('button', { name: 'More options' }).click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(win.locator('#np-branch')).toHaveValue(/^task-/)
    await win.keyboard.press('Escape')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
