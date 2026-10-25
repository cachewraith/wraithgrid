// A project's team (#79) against the fake claude and fake codex: start, focus, stop.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('a Claude reviewer and a Codex builder start together, each on its branch', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-team-'))
  const home = path.join(tmp, 'home')
  const data = path.join(tmp, 'data')
  const proj = path.join(home, 'proj')
  fs.mkdirSync(proj, { recursive: true })
  fs.mkdirSync(data)
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: proj })
  git('init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(proj, 'a.txt'), 'a\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  fs.mkdirSync(path.join(home, '.wraithgrid/accounts/codex'), { recursive: true })
  fs.writeFileSync(path.join(home, '.wraithgrid/accounts/codex/auth.json'), '{}')
  const agent = (id: string, role: string, accountId: string, prompt: string) => ({
    id,
    role,
    accountId,
    prompt,
    folder: 'worktree'
  })
  fs.writeFileSync(
    path.join(data, 'config.json'),
    JSON.stringify({
      version: 1,
      claudePath: path.join(ROOT, 'tests/fixtures/fake-claude.sh'),
      accounts: [
        { id: 'work', name: 'work', cli: 'claude', configDir: '~/.wraithgrid/accounts/work' },
        { id: 'codex', name: 'cx', cli: 'codex', configDir: '~/.wraithgrid/accounts/codex' }
      ].map((a) => ({ ...a, color: '#7c5cff', signedIn: true })),
      workspaces: [
        {
          id: 'ws',
          name: 'project',
          folder: '~/proj',
          panes: [],
          layout: null,
          team: [
            agent('t-rev', 'Reviewer', 'work', 'Review PEACH'),
            agent('t-bld', 'Builder', 'codex', 'Build PLUM')
          ]
        }
      ],
      activeWorkspace: 'ws',
      recentFolders: [],
      settings: {
        cliPaths: { codex: path.join(ROOT, 'tests/fixtures/fake-codex.mjs') },
        checkUpdatesOnLaunch: false
      }
    })
  )
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: data }
  })
  const paneOf = (role: string) =>
    win.locator('section.pane', { has: win.locator('.ph-title', { hasText: role }) })
  const win = await app.firstWindow()
  try {
    await win.waitForSelector('.app .tb')
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    await side.locator('.ws-row', { hasText: 'project' }).click()
    const team = win.getByRole('region', { name: 'Team' })
    await expect(team.locator('.team-row')).toHaveCount(2)
    await expect(team).toContainText('team/reviewer')

    // ---- Add an agent, then remove it: the form saves into the list.
    await team.getByRole('button', { name: 'Add agent' }).click()
    const form = team.getByRole('form', { name: 'New agent' })
    await form.getByLabel('Role').fill('Tests')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(team.locator('.team-row')).toHaveCount(3)
    // Its default account is the reviewer's: one limit for both (#100).
    await expect(team.locator('.team-share')).toHaveText('Reviewer and Tests share work: one limit')
    await team.getByRole('button', { name: 'Agent Tests' }).click()
    await win.getByRole('menuitem', { name: 'Remove' }).click()
    await expect(team.locator('.team-row')).toHaveCount(2)
    await expect(team.locator('.team-share')).toHaveCount(0)

    // ---- Start: both open side by side, each in its own worktree, role prompt sent first.
    await team.getByRole('button', { name: 'Start team' }).click()
    await expect(win.locator('section.pane')).toHaveCount(2)
    await expect(paneOf('Reviewer').locator('.cmsg.user').first()).toHaveText('Review PEACH')
    await expect(paneOf('Builder').locator('.cmsg.agent').last()).toContainText(
      'Hello from fake codex: Build PLUM'
    )
    const [r, b] = [await paneOf('Reviewer').boundingBox(), await paneOf('Builder').boundingBox()]
    expect(Math.abs(r!.y - b!.y)).toBeLessThan(2)
    expect(r!.x).toBeLessThan(b!.x)
    for (const dir of ['team-reviewer', 'team-builder'])
      expect(fs.existsSync(path.join(home, '.wraithgrid/worktrees/proj', dir, 'a.txt'))).toBe(true)
    await expect(paneOf('Reviewer').locator('.cc-folder')).toContainText('team/reviewer')

    // ---- Again: the open agents are focused, not started twice.
    await side.locator('.ws-row', { hasText: 'project' }).click()
    await expect(team).toContainText('2 of 2 running')
    // The account's use as the CLI last reported it (#100).
    await expect(
      team.locator('.team-row', { hasText: 'Reviewer' }).locator('.team-use')
    ).toHaveText(/^\d+%$/)
    await team.getByRole('button', { name: 'Agent Builder' }).click()
    await win.getByRole('menuitem', { name: 'Show this agent' }).click()
    await expect(win.locator('section.pane')).toHaveCount(2)
    await expect(win.locator('section.pane.focused .ph-title')).toHaveText('Builder')

    // ---- Stop: both close and go to History; the team is saved with the project.
    await side.locator('.ws-row', { hasText: 'project' }).click()
    await expect(paneOf('Reviewer').locator('.st')).toHaveText(/idle|done/)
    await team.getByRole('button', { name: 'Stop team' }).click()
    await expect(win.locator('section.pane')).toHaveCount(0)
    await expect(win.getByRole('region', { name: 'History' })).toContainText('Reviewer')
    await expect(team.getByRole('button', { name: 'Start team' })).toBeVisible()
    const saved = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'))
    expect(saved.workspaces[0].team.map((a: { role: string }) => a.role)).toEqual([
      'Reviewer',
      'Builder'
    ])

    // ---- Starting again reuses each agent's branch folder.
    await team.getByRole('button', { name: 'Start team' }).click()
    await expect(win.locator('section.pane')).toHaveCount(2)
    await expect(paneOf('Builder').locator('.cnote')).toHaveCount(0)
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
