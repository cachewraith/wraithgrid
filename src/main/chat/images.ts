// Pasted chat images for CLIs that read them from a file (agy's `@path`, codex's localImage):
// written to a private temp folder; files older than a day go the next time.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CHAT_IMAGE_EXT, type ChatImage } from '@shared/chat'

const KEEP_MS = 24 * 60 * 60 * 1000

/** Writes each image to a file and returns their paths, in order. */
export function saveChatImages(
  images: ChatImage[],
  dir = path.join(os.tmpdir(), 'wraithgrid-chat-images'),
  now = Date.now()
): string[] {
  if (!images.length) return []
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const name of readdirSync(dir)) {
    const f = path.join(dir, name)
    try {
      if (now - statSync(f).mtimeMs > KEEP_MS) rmSync(f, { force: true })
    } catch {
      // Gone already.
    }
  }
  return images.map((img, i) => {
    const ext = Object.entries(CHAT_IMAGE_EXT).find(([, t]) => t === img.mediaType)?.[0] ?? '.png'
    const file = path.join(dir, `img-${now}-${i}-${Math.random().toString(36).slice(2, 8)}${ext}`)
    writeFileSync(file, Buffer.from(img.data, 'base64'), { mode: 0o600 })
    return file
  })
}
