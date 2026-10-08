import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  imagePasteText,
  pickImageType,
  readClipboardImage,
  saveClipboardImage
} from '../../src/main/clipboard-image'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])

describe('readClipboardImage', () => {
  it('uses the native clipboard image first', async () => {
    const calls: string[][] = []
    const img = await readClipboardImage({
      readNative: async () => ({ data: png, ext: 'png' }),
      run: async (_f, args) => (calls.push(args), null),
      wayland: true
    })
    expect(img).toEqual({ data: png, ext: 'png' })
    expect(calls).toEqual([])
  })

  it('falls back to wl-paste on Wayland, picking an offered image type', async () => {
    const calls: string[][] = []
    const img = await readClipboardImage({
      readNative: async () => null,
      run: async (file, args) => {
        calls.push([file, ...args])
        return args[0] === '--list-types' ? Buffer.from('text/plain\nimage/jpeg\n') : png
      },
      wayland: true
    })
    expect(img).toEqual({ data: png, ext: 'jpg' })
    expect(calls[1]).toEqual(['wl-paste', '--no-newline', '--type', 'image/jpeg'])
  })

  it('returns null without an image, and skips wl-paste off Wayland', async () => {
    const run = async (): Promise<Buffer> => Buffer.from('text/plain\n')
    expect(await readClipboardImage({ readNative: async () => null, run, wayland: true })).toBe(
      null
    )
    let ran = false
    const img = await readClipboardImage({
      readNative: async () => {
        throw new Error('no clipboard')
      },
      run: async () => ((ran = true), png),
      wayland: false
    })
    expect(img).toBe(null)
    expect(ran).toBe(false)
  })

  it('prefers png over other types', () => {
    expect(pickImageType('image/bmp\nimage/png')).toEqual(['image/png', 'png'])
    expect(pickImageType('text/html')).toBe(null)
  })
})

describe('saveClipboardImage', () => {
  let dir = ''
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('writes the image and removes pastes older than a day', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-paste-'))
    const old = path.join(dir, 'paste-old.png')
    fs.writeFileSync(old, 'x')
    const now = Date.now()
    fs.utimesSync(old, new Date(now - 2 * 86_400_000), new Date(now - 2 * 86_400_000))
    const file = await saveClipboardImage({ data: png, ext: 'png' }, dir, now)
    expect(path.dirname(file)).toBe(dir)
    expect(file.endsWith('.png')).toBe(true)
    expect(fs.readFileSync(file)).toEqual(png)
    expect(fs.existsSync(old)).toBe(false)
  })
})

describe('imagePasteText', () => {
  it('pastes a path for claude and an @ reference for gemini and agy', () => {
    expect(imagePasteText('claude', '/tmp/p.png')).toBe('/tmp/p.png ')
    expect(imagePasteText('gemini', '/tmp/p.png')).toBe('@/tmp/p.png ')
    expect(imagePasteText('agy', '/tmp/p.png')).toBe('@/tmp/p.png ')
  })

  it('quotes a path with spaces', () => {
    expect(imagePasteText('claude', 'C:\\Users\\Jo Do\\p.png')).toBe('"C:\\Users\\Jo Do\\p.png" ')
  })
})
