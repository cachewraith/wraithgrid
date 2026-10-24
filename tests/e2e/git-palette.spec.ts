import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')
const FAKE_CLAUDE = path.join(ROOT, 'tests/fixtures/fake-claude.sh')
const SHOTS = process.env.WRAITHGRID_E2E_SHOTS

test.skip(process.platform === 'win32', 'POSIX-only fixture')

/** New chat: opens the folder picker, types a path and picks it (Ctrl+Enter). */
async function pickFolder(win: Page, folder: string): Promise<void> {
  await win.getByRole('button', { name: /^Folder / }).click()
  const picker = win.getByRole('group', { name: 'Choose a folder' })
  await picker.getByLabel('Filter folders or type a path').fill(folder)
  await picker.getByLabel('Filter folders or type a path').press('Control+Enter')
  await expect(picker).toHaveCount(0)
}

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

test('sidebar pane list, palette, git chip, diff panel and worktree panes', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-git-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  const repo = path.join(home, 'proj', 'api')
  fs.mkdirSync(repo, { recursive: true })
  fs.mkdirSync(path.join(home, 'notes'), { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  // The app's own commits read the identity from the test home.
  fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = t\n\temail = t@t\n')
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'auth.ts'), 'export const a = 1\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
  fs.writeFileSync(path.join(repo, 'auth.ts'), 'export const a = 2\nexport const b = 3\n')

  fs.writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: FAKE_CLAUDE,
      accounts: [
        {
          id: 'a-work',
          name: 'work',
          configDir: '~/.wraithgrid/accounts/work',
          color: '#2dd4bf',
          signedIn: true,
          imported: false
        }
      ],
      workspaces: [
        {
          id: 'ws-main',
          name: 'main',
          panes: [
            {
              id: 'p-api',
              accountId: 'a-work',
              cwd: '~/proj/api',
              args: [],
              shell: false,
              title: 'api'
            },
            {
              id: 'p-notes',
              accountId: 'a-work',
              cwd: '~/notes',
              args: [],
              shell: false,
              title: 'notes'
            }
          ],
          layout: null
        },
        { id: 'ws-side', name: 'side', panes: [], layout: null }
      ],
      activeWorkspace: 'ws-main',
      recentFolders: [],
      settings: { checkUpdatesOnLaunch: false }
    })
  )

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    await win.setViewportSize({ width: 1440, height: 860 })
    const side = win.getByRole('complementary', { name: 'Sidebar' })

    // Projects are dropdowns of their chats (#59, #67). The focused chat's project is open.
    const toggle = side.getByRole('button', { name: /chats in main$/ })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const group = side.getByRole('group', { name: 'Chats in main' })
    const cards = group.locator('.side-chat')
    await expect(cards).toHaveCount(2)
    // Plain one-line rows: the title; branch (or folder) and account only in the tooltip.
    const apiCard = cards.filter({ hasText: 'api' })
    await expect(apiCard.locator('.sch-t')).toHaveText('api')
    await expect(apiCard).toHaveAttribute('title', 'api · main · work')
    await expect(cards.filter({ hasText: 'notes' })).toHaveAttribute(
      'title',
      'notes · notes · work'
    )
    await expect(side.locator('.side-chat .initial')).toHaveCount(0)
    await apiCard.click()
    await expect(apiCard).toHaveClass(/\bon\b/)
    // In the grid the chat is what's highlighted, not its project.
    await expect(side.locator('.ws-row.on')).toHaveCount(0)
    // Closing is saved; the arrow keys open and close it from the project row too.
    const openSaved = (): string[] =>
      JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8')).settings
        .sidebarOpenProjects
    await toggle.click()
    await expect(group).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(openSaved).toEqual([])
    await side.locator('.ws-row', { hasText: 'main' }).focus()
    await win.keyboard.press('ArrowRight')
    await expect(group).toBeVisible()
    await expect.poll(openSaved).toEqual(['ws-main'])
    // A project with no chats has nothing to open.
    await expect(side.getByRole('button', { name: 'Show chats in side' })).toBeDisabled()
    // Only the list scrolls: in a short window it never covers the account footer.
    await win.setViewportSize({ width: 1440, height: 360 })
    const covered = await side.locator('.side-ft').evaluate((ft) => {
      const r = ft.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !ft.contains(hit)
    })
    expect(covered).toBe(false)
    await expect(side.locator('.side-list')).toHaveCSS('overflow-y', 'auto')
    await win.setViewportSize({ width: 1440, height: 860 })

    // A project's screen lists its chats; clicking one focuses it in the grid.
    await side.locator('.ws-row', { hasText: 'main' }).click()
    await expect(side.locator('.ws-row.on .ws-name')).toHaveText('main')
    const open = win.getByRole('region', { name: 'Open chats' })
    await expect(open.locator('.pj-row', { hasText: 'api' })).toBeVisible()
    await open.locator('.pj-row', { hasText: 'notes' }).click()
    await expect(win.locator('section.pane.focused .ph-title')).toHaveText('notes')

    // The repo pane shows its branch and one changed file; the other folder shows none.
    const apiPane = win.locator('section.pane', {
      has: win.locator('.ph-title', { hasText: 'api' })
    })
    await expect(apiPane.locator('.gitc')).toContainText('main')
    await expect(apiPane.locator('.gitc-n')).toHaveText('1')
    const notesPane = win.locator('section.pane', {
      has: win.locator('.ph-title', { hasText: 'notes' })
    })
    await expect(notesPane.locator('.gitc')).toHaveCount(0)
    if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'grid-dark.png') })

    // The chip opens the diff of that pane.
    await apiPane.locator('.gitc').click()
    const panel = win.getByRole('complementary', { name: 'Changes' })
    await expect(panel.locator('.df-name')).toContainText('auth.ts')
    await expect(panel.locator('.dl-add')).toHaveCount(2)
    await expect(panel.locator('.dl-del')).toHaveCount(1)
    if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'diff-dark.png') })

    // Commit everything from the panel, then push after confirming.
    const bare = path.join(tmp, 'remote.git')
    git(tmp, 'init', '-q', '--bare', bare)
    git(repo, 'remote', 'add', 'origin', bare)
    await panel.getByRole('textbox', { name: 'Commit message' }).fill('feat: b')
    await panel.getByRole('button', { name: 'Commit all (1)' }).click()
    await expect(panel.getByRole('status')).toContainText('Committed')
    expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('feat: b')
    await expect(panel.locator('.dp-empty')).toContainText('No changes')
    await panel.getByRole('button', { name: /^Push/ }).click()
    await expect(panel.getByRole('alert')).toContainText('Push main to its remote?')
    await panel.getByRole('button', { name: 'Push', exact: true }).click()
    await expect(panel.getByRole('status')).toContainText('Pushed main to origin')
    expect(git(bare, 'log', '-1', '--format=%s', 'main').trim()).toBe('feat: b')

    // Pull: a commit pushed from elsewhere comes in, and says how many.
    const other = path.join(tmp, 'other')
    git(tmp, 'clone', '-q', '-b', 'main', bare, other)
    fs.writeFileSync(path.join(other, 'theirs.txt'), 'theirs\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'feat: theirs')
    git(other, 'push', '-q', 'origin', 'main')
    await panel.getByRole('button', { name: /^Pull( \(\d+\))?$/ }).click()
    await expect(panel.getByRole('status')).toHaveText('Pulled 1 commit')
    expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('feat: theirs')
    await panel.getByRole('button', { name: /^Pull( \(\d+\))?$/ }).click()
    await expect(panel.getByRole('status')).toHaveText('Up to date')

    // History: the commits as a graph with branch labels; a commit opens its files.
    await panel.getByRole('tab', { name: 'History' }).click()
    const history = panel.getByRole('list', { name: 'Commit history' })
    const top = history.locator('.gh-row').first()
    await expect(top).toContainText('feat: theirs')
    await expect(top.locator('.gh-ref.head')).toHaveText('main')
    await expect(top.locator('.gh-g circle')).toHaveCount(1)
    await history.locator('.gh-row', { hasText: 'feat: b' }).locator('.gh-main').click()
    await expect(history.locator('.gh-files .df-name')).toContainText('auth.ts')
    if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'history-dark.png') })
    await panel.getByRole('tab', { name: 'Changes' }).click()

    // Switch branch: right-click the chip, filter, Enter.
    git(repo, 'branch', 'older')
    git(repo, 'push', '-q', 'origin', 'main:refs/heads/theirs')
    git(repo, 'fetch', '-q', 'origin')
    await apiPane.locator('.gitc').click({ button: 'right' })
    const picker = win.getByRole('dialog', { name: /^Switch branch of/ })
    await expect(picker.getByRole('option')).toHaveCount(3) // main, older, origin/theirs
    if (SHOTS) {
      await win.waitForTimeout(300) // past the menu's fade-in
      await win.screenshot({ path: path.join(SHOTS, 'branches-dark.png') })
    }
    await picker.getByRole('textbox', { name: 'Find or create a branch' }).fill('old')
    await win.keyboard.press('Enter')
    await expect(picker).toHaveCount(0)
    await expect(apiPane.locator('.gitc')).toContainText('older')
    expect(git(repo, 'branch', '--show-current').trim()).toBe('older')
    // A remote-only branch becomes a local one tracking it; the panel's branch opens the picker too.
    await panel.locator('button.dp-branch').click()
    await picker.getByRole('option', { name: /origin\/theirs/ }).click()
    await expect(apiPane.locator('.gitc')).toContainText('theirs')
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{u}').trim()).toBe('origin/theirs')
    // A name no branch has offers to create it.
    await apiPane.locator('.gitc').click({ button: 'right' })
    await picker.getByRole('textbox', { name: 'Find or create a branch' }).fill('feat/picked')
    await picker.getByRole('option', { name: /Create branch feat\/picked/ }).click()
    await expect(apiPane.locator('.gitc')).toContainText('feat/picked')
    await apiPane.locator('.gitc').click({ button: 'right' })
    await picker.getByRole('textbox', { name: 'Find or create a branch' }).fill('main')
    await win.keyboard.press('Enter')
    await expect(apiPane.locator('.gitc')).toContainText('main')

    await win.keyboard.press('Control+Shift+D')
    await expect(panel).toHaveCount(0)

    // The palette finds panes in other workspaces and runs commands.
    await win.keyboard.press('Control+Shift+P')
    const search = win.getByRole('textbox', { name: 'Search' })
    await expect(search).toBeFocused()
    await search.fill('notes work')
    await expect(win.locator('.cp-row')).toHaveCount(1)
    await search.fill('light theme')
    if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'palette-dark.png') })
    await win.keyboard.press('Enter')
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'light')
    if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'grid-light.png') })

    // New pane on a fresh worktree branch.
    await win.keyboard.press('Control+Shift+N')
    await pickFolder(win, '~/proj/api')
    await win.getByRole('button', { name: 'More options' }).click()
    await win.getByRole('switch', { name: 'Work on a new branch (git worktree)' }).click()
    await win.locator('#np-branch').fill('feat/limit')
    if (SHOTS) await win.screenshot({ path: path.join(SHOTS, 'new-pane-light.png') })
    await win.getByRole('button', { name: /Create pane|Start chat/ }).click()
    const wtPane = win.locator('section.pane', {
      has: win.locator('.ph-title', { hasText: 'feat-limit' })
    })
    await expect(wtPane.locator('.gitc')).toContainText('feat/limit')
    const wtDir = path.join(home, '.wraithgrid', 'worktrees', 'api', 'feat-limit')
    expect(git(wtDir, 'branch', '--show-current').trim()).toBe('feat/limit')

    // An existing branch is refused with git's message, and the dialog stays open.
    await win.keyboard.press('Control+Shift+N')
    await pickFolder(win, '~/proj/api')
    await win.getByRole('button', { name: 'More options' }).click()
    await win.getByRole('switch', { name: 'Work on a new branch (git worktree)' }).click()
    await win.locator('#np-branch').fill('feat/limit')
    await win.getByRole('button', { name: /Create pane|Start chat/ }).click()
    await expect(win.getByRole('alert')).toContainText('already exists')
    // Esc closes it, though the busy button let go of the focus.
    await win.keyboard.press('Escape')
    await expect(win.locator('.scrim')).toHaveCount(0)

    // Closing the worktree's last pane offers to remove it, naming uncommitted files.
    fs.writeFileSync(path.join(wtDir, 'wip.ts'), 'x\n')
    await wtPane.getByRole('button', { name: /^Close pane/ }).click()
    const ask = win.getByRole('alertdialog', { name: /Remove the worktree/ })
    await expect(ask).toContainText('1 file is not committed')
    await ask.getByRole('button', { name: 'Remove and lose 1 file' }).click()
    await expect(ask).toHaveCount(0)
    expect(fs.existsSync(wtDir)).toBe(false)
    expect(git(repo, 'branch', '--list', 'feat/limit').trim()).toBe('feat/limit')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('New chat: the built-in folder picker browses, filters, jumps and picks by keyboard', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-picker-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  for (const d of ['code/api', 'code/web', 'code/.cache', 'notes'])
    fs.mkdirSync(path.join(home, d), { recursive: true })
  git(path.join(home, 'code/api'), 'init', '-q', '-b', 'trunk')
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: FAKE_CLAUDE,
      accounts: [
        {
          id: 'a-work',
          name: 'work',
          configDir: '~/.wraithgrid/accounts/work',
          color: '#7c5cff',
          signedIn: true,
          imported: false
        }
      ],
      workspaces: [{ id: 'ws-main', name: 'main', panes: [], layout: null }],
      activeWorkspace: 'ws-main',
      recentFolders: ['~/notes'],
      settings: { newPaneView: 'terminal', checkUpdatesOnLaunch: false }
    })
  )
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    await win.waitForSelector('.app .tb')
    await win.keyboard.press('Control+Shift+N')
    const dlg = win.getByRole('dialog', { name: 'New pane' })
    // The most recent folder is chosen; launch args and the rest wait under More options.
    await expect(dlg.getByRole('button', { name: /^Folder notes/ })).toBeVisible()
    await expect(dlg.locator('#np-args')).toHaveCount(0)

    await dlg.getByRole('button', { name: /^Folder / }).click()
    const picker = win.getByRole('group', { name: 'Choose a folder' })
    const input = picker.getByLabel('Filter folders or type a path')
    await expect(input).toBeFocused()
    // Type a path to jump; Enter goes there.
    await input.fill('~/code')
    await input.press('Enter')
    await expect(picker.getByRole('navigation', { name: 'Path' })).toContainText('~/code')
    // Folders only, hidden ones off; git repos marked.
    const list = picker.getByRole('listbox', { name: 'Folders' })
    await expect(list.getByRole('option')).toHaveText(['apigit', 'web'])
    await picker.getByLabel('Hidden').check()
    await expect(list.getByRole('option')).toHaveCount(3)
    // Filter, arrows, Enter opens; Backspace goes up.
    await input.fill('we')
    await expect(list.getByRole('option')).toHaveText(['web'])
    await input.fill('')
    // .cache, api, web: one down from the first is api.
    await input.press('ArrowDown')
    await expect(list.getByRole('option', { selected: true })).toContainText('api')
    await input.press('Enter')
    await expect(picker.getByRole('navigation', { name: 'Path' })).toContainText('api')
    await expect(picker.locator('.fp-branch')).toHaveText('trunk')
    await input.press('Backspace')
    await expect(picker.getByRole('button', { name: 'code', exact: true })).toHaveAttribute(
      'aria-current',
      'location'
    )
    // A missing folder says so; Esc goes back to the dialog, not out of it.
    await input.fill('~/nope')
    await input.press('Control+Enter')
    await expect(picker.getByRole('alert')).toContainText('does not exist')
    await input.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(dlg).toBeVisible()

    // Pick ~/code/api: the field shows the name first, the place muted, and the branch.
    await dlg.getByRole('button', { name: /^Folder / }).click()
    await input.fill('~/code/api')
    await input.press('Control+Enter')
    const field = dlg.getByRole('button', { name: /^Folder api/ })
    await expect(field).toContainText('~/code')
    await expect(field).toContainText('trunk')
    await dlg.getByRole('button', { name: 'Create pane' }).click()
    await expect(win.locator('section.pane .ph-title')).toHaveText('api')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
