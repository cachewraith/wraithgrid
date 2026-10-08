import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentCli } from '@shared/types'

// Agent CLIs read a pasted image from the clipboard themselves (claude via xclip/wl-paste),
// which misses images that only some Linux clipboards expose, e.g. screenshots copied by a
// Wayland-native tool. Wraithgrid reads the image itself, saves it to a temp file and pastes
// the path, which claude attaches as an image and gemini/agy read as an `@file` reference.

/** Clipboard image types we save, best first, with the file extension each gets. */
const IMAGE_TYPES: [mime: string, ext: string][] = [
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/bmp', 'bmp']
]

/** Saved images older than this are removed the next time one is saved. */
const KEEP_MS = 24 * 60 * 60 * 1000

export interface ClipboardImage {
  data: Buffer
  ext: string
}

export interface ClipboardImageDeps {
  /** Electron's clipboard image, or null when it holds none. */
  readNative: () => Promise<ClipboardImage | null>
  /** Runs a command and returns its stdout, or null when it fails or is missing. */
  run: (file: string, args: string[]) => Promise<Buffer | null>
  /** Whether a Wayland session is running (wl-paste is then tried as well). */
  wayland: boolean
}

/** The first item type we save, from what a clipboard offers. */
export function pickImageMime(types: readonly string[]): [mime: string, ext: string] | null {
  return IMAGE_TYPES.find(([mime]) => types.includes(mime)) ?? null
}

/** Picks the first image type wl-paste offers, from its `--list-types` output. */
export function pickImageType(listed: string): [mime: string, ext: string] | null {
  return pickImageMime(listed.split(/\r?\n/).map((l) => l.trim()))
}

/** The clipboard's image, or null when it holds none. */
export async function readClipboardImage(deps: ClipboardImageDeps): Promise<ClipboardImage | null> {
  const native = await deps.readNative().catch(() => null)
  if (native && native.data.length > 0) return native
  if (!deps.wayland) return null
  const listed = await deps.run('wl-paste', ['--list-types'])
  const picked = listed ? pickImageType(listed.toString('utf8')) : null
  if (!picked) return null
  const data = await deps.run('wl-paste', ['--no-newline', '--type', picked[0]])
  return data && data.length > 0 ? { data, ext: picked[1] } : null
}

/** Writes `image` into `dir` (created 0700) and drops old pastes; returns the file path. */
export async function saveClipboardImage(
  image: ClipboardImage,
  dir: string,
  now: number = Date.now()
): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  for (const name of await readdir(dir).catch(() => [])) {
    const f = path.join(dir, name)
    const s = await stat(f).catch(() => null)
    if (s?.isFile() && now - s.mtimeMs > KEEP_MS) await rm(f, { force: true })
  }
  const file = path.join(dir, `paste-${now}-${Math.random().toString(36).slice(2, 8)}.${image.ext}`)
  await writeFile(file, image.data, { mode: 0o600 })
  return file
}

/** How a pasted image path is typed into a pane: gemini and agy take `@path` references. */
export function imagePasteText(cli: AgentCli, file: string): string {
  const quoted = /\s/.test(file) ? `"${file}"` : file
  return cli === 'claude' ? `${quoted} ` : `@${quoted} `
}
