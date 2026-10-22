// Files picked in the chat's attach dialog: main reads the images itself (the paths came from
// its own native dialog, never from the renderer); everything else goes on as a path.
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  CHAT_FILES_MAX,
  CHAT_IMAGE_EXT,
  CHAT_IMAGE_MAX,
  CHAT_IMAGES_MAX,
  type ChatPickResult
} from '@shared/chat'

export async function readPicked(paths: string[]): Promise<ChatPickResult> {
  const out: ChatPickResult = { images: [], files: [] }
  for (const p of paths) {
    const type = CHAT_IMAGE_EXT[path.extname(p).toLowerCase()]
    // Base64 is 4/3 of the size: a bigger image goes as a path, claude can still read it.
    const fits =
      type &&
      out.images.length < CHAT_IMAGES_MAX &&
      Math.ceil((await stat(p)).size / 3) * 4 <= CHAT_IMAGE_MAX
    if (fits) out.images.push({ mediaType: type, data: (await readFile(p)).toString('base64') })
    else if (out.files.length < CHAT_FILES_MAX) out.files.push(p)
  }
  return out
}
