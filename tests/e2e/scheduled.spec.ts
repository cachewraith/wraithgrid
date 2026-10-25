// Scheduled chats (#77) against the fake claude: a due job runs, a late one is missed, the
// page lists them, and the dialog makes a new one.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('a due job starts its chat, a late one is missed, a new one is saved', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-sched-'))
  const home = path.join(tmp, 'home')
  const data = path.join(tmp, 'data')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(data)
  const job = (id: string, prompt: string, nextAt: number) => ({
    id,
    wsId: 'ws',
    accountId: 'work',
    prompt,
    when: { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' },
    nextAt
  })
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
      workspaces: [{ id: 'ws', name: 'project', folder: '~/proj', panes: [], layout: null }],
      activeWorkspace: 'ws',
      recentFolders: [],
      settings: { checkUpdatesOnLaunch: false, newPaneView: 'chat' },
      schedules: [
        job('j-due', 'Review PEACH', Date.now() - 60_000),
        job('j-late', 'Draft PLUM notes', Date.now() - 2 * 3600_000)
      ]
    })
  )
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: data }
  })
  const win = await app.firstWindow()
  try {
    await win.waitForSelector('.app .tb')
    // The due job ran at start: its chat sent the prompt in the project.
    const chat = win.locator('section.pane')
    await expect(chat).toHaveCount(1, { timeout: 15_000 })
    await expect(chat.locator('.cmsg.agent').last()).toContainText('Review PEACH')

    const side = win.getByRole('complementary', { name: 'Sidebar' })
    await side.getByRole('button', { name: 'Scheduled' }).click()
    const list = win.getByRole('list', { name: 'Scheduled jobs' })
    const due = list.getByRole('listitem').filter({ hasText: 'Review PEACH' })
    const late = list.getByRole('listitem').filter({ hasText: 'Draft PLUM notes' })
    await expect(late.locator('.sch-r')).toHaveText('missed')
    await expect(due).toContainText('daily 09:00')
    // Finished once its chat went quiet (checked every 15 s).
    await expect(due.locator('.sch-r')).toHaveText('done', { timeout: 40_000 })

    // Off: no next run.
    await late.getByRole('switch').click()
    await expect(late).toContainText('off')

    // Run now, off schedule: a second chat with that prompt.
    await late.getByRole('button', { name: /^Job actions/ }).click()
    await win.getByRole('menuitem', { name: 'Run now' }).click()
    await expect(chat).toHaveCount(2)

    // A new job from the dialog.
    await win.getByRole('button', { name: 'New job' }).click()
    const dlg = win.getByRole('dialog', { name: 'New scheduled job' })
    await dlg.getByLabel('Prompt').fill('Check the build')
    await dlg.getByRole('radio', { name: 'Every N hours' }).click()
    await expect(dlg).toContainText('Next runs:')
    await dlg.getByRole('button', { name: 'Save job' }).click()
    await expect(list.getByRole('listitem')).toHaveCount(3)
    await expect(list.getByRole('listitem').filter({ hasText: 'Check the build' })).toContainText(
      'every 6 hours'
    )
    const saved = () => JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'))
    await expect.poll(() => saved().schedules.length).toBe(3)
    expect(saved().schedules.find((j: { id: string }) => j.id === 'j-late').enabled).toBe(false)
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
