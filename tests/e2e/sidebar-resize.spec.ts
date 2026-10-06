import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.join(ROOT, 'out/main/index.js')

test('dragging the sidebar edge resizes it, saves the width, and double-click resets it', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-resize-e2e-'))
  const home = path.join(tmp, 'home')
  const userData = path.join(tmp, 'userdata')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  const cfgFile = path.join(userData, 'config.json')
  const saved = () => JSON.parse(fs.readFileSync(cfgFile, 'utf8'))

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, HOME: home, WRAITHGRID_USER_DATA_DIR: userData }
  })
  try {
    const win = await app.firstWindow()
    const side = win.getByRole('complementary', { name: 'Sidebar' })
    const handle = win.getByRole('separator', { name: 'Resize sidebar' })
    const width = async () => (await side.boundingBox())!.width

    await expect.poll(width).toBe(236)
    const box = (await handle.boundingBox())!
    const y = box.y + 200
    await win.mouse.move(box.x, y)
    await win.mouse.down()
    for (let i = 1; i <= 10; i++) await win.mouse.move(box.x + i * 10, y)
    await win.mouse.up()
    await expect.poll(width).toBe(336)
    await expect.poll(() => saved().settings.sidebarWidth).toBe(336)

    // Clamped at the maximum.
    const box2 = (await handle.boundingBox())!
    await win.mouse.move(box2.x, y)
    await win.mouse.down()
    await win.mouse.move(box2.x + 600, y, { steps: 5 })
    await win.mouse.up()
    await expect.poll(width).toBe(480)

    // The handle itself is 0px wide; its hit area is a pseudo-element straddling the edge.
    await win.mouse.dblclick((await handle.boundingBox())!.x, y)
    await expect.poll(width).toBe(236)
    await expect.poll(() => saved().settings.sidebarWidth).toBe(236)
  } finally {
    await app.close()
  }
})
