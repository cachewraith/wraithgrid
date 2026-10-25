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

test('Send later queues a message in the chat; Send now and Cancel', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-later-'))
  const home = path.join(tmp, 'home')
  const data = path.join(tmp, 'data')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(data)
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
          folder: '~/proj',
          panes: [{ id: 'p1', accountId: 'work', cwd: '~/proj', title: 'main chat', view: 'chat' }],
          layout: { type: 'pane', paneId: 'p1' }
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
  const win = await app.firstWindow()
  try {
    const box = win.getByLabel('Message', { exact: true })
    // A first turn: the fake reports the account's limits, so its reset is known.
    await box.fill('hello')
    await box.press('Enter')
    await expect(win.locator('.cmsg.agent').last()).toContainText('hello')
    const later = win.getByRole('button', { name: 'Send later' })
    await expect(later).toBeDisabled()

    // In 1 hour: queued above the box, the box empties; Send now sends it.
    await box.fill('Remember MANGO')
    await later.click()
    await win.getByRole('menuitem', { name: /^In 1 hour/ }).click()
    await expect(box).toHaveValue('')
    const strip = win.getByRole('status', { name: 'Queued message' })
    await expect(strip).toContainText('Remember MANGO')
    // After 23:00 "in 1 hour" is tomorrow, shown with its day (`at Mon 00:00`).
    await expect(strip).toContainText(/at (\w{3} )?\d\d:\d\d/)
    await strip.getByRole('button', { name: 'Send now' }).click()
    await expect(strip).toHaveCount(0)
    await expect(win.locator('.cmsg.agent').last()).toContainText('Remember MANGO')

    // When the limit resets: listed on the Scheduled page too; Cancel drops it.
    await box.fill('Carry on PAPAYA')
    await later.click()
    await win.getByRole('menuitem', { name: /^When work's limit resets/ }).click()
    await expect(strip).toContainText('when work limit resets')
    await win
      .getByRole('complementary', { name: 'Sidebar' })
      .getByRole('button', { name: 'Scheduled' })
      .click()
    const q = win.getByRole('region', { name: 'Queued messages' })
    await expect(q).toContainText('Carry on PAPAYA')
    await q.getByRole('button', { name: 'Cancel' }).click()
    await expect(q).toHaveCount(0)
    const saved = () => JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'))
    // Until the app has rewritten the file, the fixture has no schedules at all.
    await expect.poll(() => saved().schedules?.length).toBe(0)
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('a job on a project without a folder runs in its chats folder; none at all asks (#109)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-sched-'))
  const home = path.join(tmp, 'home')
  const data = path.join(tmp, 'data')
  fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
  fs.mkdirSync(data)
  const old = { id: 'p-old', accountId: 'work', cwd: '~/proj', view: 'chat', title: 'old chat' }
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
          folder: '',
          panes: [],
          layout: null,
          history: [{ pane: old, closedAt: Date.now() - 3600_000 }]
        },
        { id: 'bare', name: 'bare', folder: '', panes: [], layout: null }
      ],
      activeWorkspace: 'ws',
      recentFolders: [],
      settings: { checkUpdatesOnLaunch: false, newPaneView: 'chat' },
      schedules: [
        {
          id: 'j-due',
          wsId: 'ws',
          accountId: 'work',
          prompt: 'Review PEACH',
          when: { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' },
          nextAt: Date.now() - 60_000
        }
      ]
    })
  )
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: data }
  })
  const win = await app.firstWindow()
  const saved = () => JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'))
  try {
    await win.waitForSelector('.app .tb')
    // The run opened in the folder the project's chats use, not ~.
    const chat = win.locator('section.pane')
    await expect(chat).toHaveCount(1, { timeout: 15_000 })
    await expect(chat.locator('.cmsg.agent').last()).toContainText('Review PEACH')
    await expect.poll(() => saved().workspaces[0].panes[0]?.cwd).toBe('~/proj')
    expect(saved().workspaces[0].folder).toBe('')

    const side = win.getByRole('complementary', { name: 'Sidebar' })
    await side.getByRole('button', { name: 'Scheduled' }).click()
    await win.getByRole('button', { name: 'New job' }).click()
    const dlg = win.getByRole('dialog', { name: 'New scheduled job' })
    await dlg.getByLabel('Prompt').fill('Check the build')
    // A project with chats needs no folder; one with none at all can't be saved without one.
    await expect(dlg.getByLabel('Project folder')).toHaveCount(0)
    await dlg.getByRole('combobox').first().selectOption('bare')
    await expect(dlg).toContainText('This project has no folder')
    const save = dlg.getByRole('button', { name: 'Save job' })
    await expect(save).toBeDisabled()
    await dlg.getByLabel('Project folder').fill('~/bare')
    await save.click()
    await expect.poll(() => saved().schedules.length).toBe(2)
    expect(saved().workspaces.find((w: { id: string }) => w.id === 'bare').folder).toBe('~/bare')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
