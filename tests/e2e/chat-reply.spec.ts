// #164: select text in a chat message, Reply, and it goes out as a quote before the typed text.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
test.skip(process.platform === 'win32', 'POSIX-only fixture')

test('select → Reply quotes the selection; several quotes, ×, the shortcut, code fenced', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-reply-'))
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
  try {
    const win = await app.firstWindow()
    const box = win.getByLabel('Message', { exact: true })
    const agent = win.locator('section.pane .cmsg.agent')
    const replyBtn = win.getByRole('button', { name: 'Reply to the selected text' })
    const quotes = win.locator('.cc-quote')

    await box.fill('first prompt')
    await box.press('Enter')
    await expect(agent.last()).toContainText('first prompt')
    // A code block in the answer: the fake echoes the message back as markdown.
    await box.fill('see\n```js\nconst a = 1\n```\nthere')
    await box.press('Enter')
    await expect(agent.last().locator('pre')).toHaveText('const a = 1')
    await expect(win.getByRole('button', { name: 'Stop (Esc)' })).toHaveCount(0)

    // No button without a selection, nor for one outside the messages.
    await expect(replyBtn).toBeHidden()
    await win.locator('.cc-folder span').first().selectText()
    await expect(replyBtn).toBeHidden()

    // Select → the button shows over the selection, which stays (copy works as before).
    await box.fill('my draft')
    const para = agent.first().locator('p').first()
    await para.selectText()
    await expect(replyBtn).toBeVisible()
    const selected = await win.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(selected).toContain('Hello from fake claude: first prompt')
    const [b, p] = [await replyBtn.boundingBox(), await para.boundingBox()]
    expect(b!.y + b!.height).toBeLessThanOrEqual(p!.y + 1)
    await replyBtn.click()
    await expect(quotes).toHaveCount(1)
    await expect(quotes.first()).toContainText('Hello from fake claude: first prompt')
    await expect(box).toBeFocused()
    await expect(box).toHaveValue('my draft')
    await expect(replyBtn).toBeHidden()

    // Esc hides the button; the shortcut still replies while text is selected.
    await para.selectText()
    await expect(replyBtn).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(replyBtn).toBeHidden()
    await win.keyboard.press('ControlOrMeta+Shift+R')
    await expect(quotes).toHaveCount(2)
    // × removes one.
    await win.getByRole('button', { name: 'Remove quote 2' }).click()
    await expect(quotes).toHaveCount(1)

    // Code keeps its fence; the card opens to the whole text.
    await agent.last().locator('pre').selectText()
    await replyBtn.click()
    await expect(quotes).toHaveCount(2)
    const card = quotes.nth(1).locator('.cc-quote-t')
    await expect(card).toHaveText('```js\nconst a = 1\n```')
    await card.click()
    await expect(card).toHaveAttribute('aria-expanded', 'true')

    // Send: the quotes first, as blockquotes, then the typed text.
    await box.fill('why this?')
    await box.press('Enter')
    await expect(quotes).toHaveCount(0)
    const sent = win.locator('section.pane .cmsg.user').last()
    await expect(sent.locator('.cmsg-quote')).toHaveCount(2)
    await expect(sent.locator('.cmsg-quote').first()).toContainText('first prompt')
    await expect(sent.locator('.cmsg-quote').nth(1)).toHaveText('```js\nconst a = 1\n```')
    await expect(sent).toContainText('why this?')
    // What the CLI got (echoed back): the markdown blockquote, then the text.
    await expect(agent.last()).toContainText('> Hello from fake claude: first prompt')
    await expect(agent.last()).toContainText('why this?')
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
