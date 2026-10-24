// Account picker and cross-CLI handoff (#78) against the official-protocol fake CLIs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const CODEX_NAME = 'org-cambodia-codex-extra-long-account-name'
const ROOT = path.resolve(__dirname, '../..')
test.skip(process.platform === 'win32', 'POSIX-only fixture')

for (const theme of ['dark', 'light'] as const) {
  test(`Claude → Codex (${theme}): picker, handoff, History and terminal`, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-handoff-'))
    const home = path.join(tmp, 'home')
    const data = path.join(tmp, 'data')
    fs.mkdirSync(path.join(home, 'proj'), { recursive: true })
    fs.mkdirSync(data)
    fs.mkdirSync(path.join(home, '.wraithgrid/accounts/codex'), { recursive: true })
    fs.writeFileSync(path.join(home, '.wraithgrid/accounts/codex/auth.json'), '{}')
    const accounts = [
      ['claude', 'work'],
      ['codex', 'codex'],
      ['gemini', 'terminal'],
      ['claude', 'unsigned']
    ].map(([cli, name]) => ({
      id: name,
      name: cli === 'codex' ? CODEX_NAME : name,
      cli,
      color: '#7c5cff',
      configDir: `~/.wraithgrid/accounts/${name}`,
      signedIn: name !== 'unsigned'
    }))
    fs.writeFileSync(
      path.join(data, 'config.json'),
      JSON.stringify({
        version: 1,
        claudePath: path.join(ROOT, 'tests/fixtures/fake-claude.sh'),
        accounts,
        workspaces: [
          {
            id: 'ws',
            name: 'project',
            folder: '~/proj',
            panes: [
              {
                id: 'source',
                accountId: 'work',
                cwd: '~/proj',
                title: 'Source chat',
                view: 'chat',
                model: 'opus',
                effort: 'high',
                chatMode: 'plan'
              }
            ],
            layout: { type: 'pane', paneId: 'source' }
          }
        ],
        activeWorkspace: 'ws',
        recentFolders: [],
        settings: {
          theme,
          cliPaths: {
            codex: path.join(ROOT, 'tests/fixtures/fake-codex.mjs'),
            gemini: path.join(ROOT, 'tests/fixtures/fake-claude.sh')
          },
          checkUpdatesOnLaunch: false
        }
      })
    )
    const app = await electron.launch({
      args: [path.join(ROOT, 'out/main/index.js')],
      env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: data }
    })
    try {
      const win = await app.firstWindow()
      const box = win.getByLabel('Message', { exact: true })
      await box.fill('Remember PEACH')
      await box.press('Enter')
      await expect(win.locator('.cmsg.agent')).toContainText('Remember PEACH')
      const chip = win.getByRole('button', { name: 'Account: work. Continue as another account' })
      await chip.click()
      const picker = win.getByRole('dialog', { name: 'Continue as', exact: true })
      await expect(picker.getByRole('option')).toHaveCount(4)
      await expect(
        picker
          .getByRole('group', { name: 'Codex', exact: true })
          .locator('.account-group > svg.provider-logo path')
      ).toHaveCount(1)
      await expect(picker).toContainText('continue · same chat')
      await expect(picker).toContainText('new chat · handoff')
      await expect(picker).toContainText('terminal · no handoff')
      const shots = process.env.WRAITHGRID_E2E_SHOTS
      if (shots) {
        fs.mkdirSync(shots, { recursive: true })
        await win.screenshot({
          animations: 'disabled',
          path: path.join(shots, `${theme}-picker.png`)
        })
      }
      const search = picker.getByRole('combobox', { name: 'Search accounts' })
      // The focused search row draws no square ring inside the rounded popover (#86).
      await expect(search).toBeFocused()
      expect(await search.evaluate((n) => getComputedStyle(n).outlineStyle)).toBe('none')
      await search.fill('unsigned')
      await expect(picker.getByRole('option')).toContainText('Sign in')
      await search.press('Escape')
      await expect(picker).toHaveCount(0)
      await expect(chip).toBeFocused()
      await chip.click()
      await search.fill('o')
      await expect(picker.getByRole('option')).toHaveCount(2)
      await search.press('ArrowDown')
      await search.press('Enter')
      const confirm = win.getByRole('dialog', { name: `Continue in Codex as ${CODEX_NAME}?` })
      await expect(confirm).toContainText('2 messages')
      if (shots)
        await win.screenshot({
          animations: 'disabled',
          path: path.join(shots, `${theme}-confirm.png`)
        })
      await expect(confirm.locator('pre')).toContainText('user: Remember PEACH')
      await expect(confirm.locator('pre')).toContainText('assistant: Hello')
      await confirm.getByRole('button', { name: 'Cancel' }).click()
      await expect(chip).toBeVisible()
      await chip.click()
      await picker.getByRole('option', { name: /^org-cambodia-codex/ }).click()
      await confirm.getByRole('button', { name: 'Continue in Codex →' }).click()
      await expect(
        win.getByRole('button', { name: `Account: ${CODEX_NAME}. Continue as another account` })
      ).toBeVisible()
      const layout = await win.locator('.cc-meta').evaluate((el) =>
        [...el.children].map((child) => {
          const r = child.getBoundingClientRect()
          return { top: r.top, height: r.height }
        })
      )
      expect(new Set(layout.map((r) => r.top)).size).toBe(1)
      expect(layout.every((r) => r.height === 30)).toBe(true)
      await expect(win.locator('section.pane')).toHaveCount(1)
      await expect(win.locator('.chat-handoff')).toContainText('Handoff from Claude · 2 messages')
      await expect(win.locator('.chat-handoff pre')).not.toBeVisible()
      await expect(win.locator('.cmsg.user')).toHaveCount(0)
      await expect(win.locator('.cmsg.agent')).toContainText('Remember PEACH')
      await expect(win.locator('.cmsg.agent')).toContainText('model default, effort default')
      // Opening on a later provider must focus the current account, so Enter is a no-op.
      const codexChip = win.getByRole('button', {
        name: `Account: ${CODEX_NAME}. Continue as another account`
      })
      await expect(codexChip.locator('svg.provider-logo path')).toHaveCount(1)
      await expect(codexChip.locator('.initial')).toHaveCount(0)
      await expect(codexChip).toBeEnabled()
      await codexChip.click()
      await expect(search).toHaveAttribute('aria-activedescendant', 'account-option-codex')
      await search.press('Enter')
      await expect(picker).toHaveCount(0)
      await expect(codexChip).toBeVisible()
      await expect(win.getByRole('dialog')).toHaveCount(0)

      if (shots)
        await win.screenshot({
          animations: 'disabled',
          path: path.join(shots, `${theme}-handoff.png`)
        })
      await win.locator('.chat-handoff summary').click()
      await expect(win.locator('.chat-handoff pre')).toContainText(
        'Continuing a conversation from Claude (work):'
      )
      await expect
        .poll(() => {
          const c = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'))
          return c.workspaces[0].history?.[0]?.pane.id
        })
        .toBe('source')
      const saved = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'))
      const target = saved.workspaces[0].panes[0]
      expect(target.id).not.toBe('source')
      expect(target.model).toBeNull()
      expect(target.effort).toBeNull()
      expect(target.chatMode).toBeNull()
      expect(saved.workspaces[0].history[0].pane.chatSessionId).toBe('fake-new')
      // Reload the renderer: the collapsed handoff survives and the source can be reopened.
      await win.waitForTimeout(1000)
      await win.reload()
      await expect(win.locator('.chat-handoff summary')).toContainText('2 messages')
      await expect(win.locator('.chat-handoff pre')).not.toBeVisible()
      await win.locator('.ws-row').filter({ hasText: 'project' }).click()
      const history = win.getByRole('region', { name: 'History' })
      await history.getByRole('button', { name: /^Source chat/ }).click()
      await expect(
        win.getByRole('button', { name: 'Account: work. Continue as another account' })
      ).toBeVisible()
      await expect(
        win
          .locator('section.pane')
          .filter({
            has: win.getByRole('button', { name: 'Account: work. Continue as another account' })
          })
          .locator('.cmsg.user')
      ).toContainText('Remember PEACH')
      // A terminal provider opens a fresh pane without carrying over chat text.
      await win.getByRole('button', { name: 'Account: work. Continue as another account' }).click()
      await win.getByRole('option', { name: /^terminal/ }).click()
      const terminalConfirm = win.getByRole('dialog', { name: 'Open Gemini as terminal?' })
      await expect(terminalConfirm).toContainText('No conversation is carried over')
      await terminalConfirm.getByRole('button', { name: 'Open Gemini terminal' }).click()
      await expect(win.locator('section.pane')).toHaveCount(3)
      await expect(win.locator('section.pane .xterm')).toHaveCount(1)
    } finally {
      await app.close()
    }
  })
}
