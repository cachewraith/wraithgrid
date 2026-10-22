import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COMMUNITY_THEMES_URL,
  CommunityThemes,
  newerVersion,
  repoFromUrl
} from '../../src/main/community-themes'
import { listThemes } from '../../src/main/themes'

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)])

/** A fake GitHub: files by URL; every URL asked for is recorded. */
function fakeFetch(files: Record<string, string | Buffer>) {
  const asked: string[] = []
  const fetch = async (url: string): Promise<Response> => {
    asked.push(url)
    const body = files[url]
    if (body === undefined) return new Response('404', { status: 404 })
    return new Response(typeof body === 'string' ? body : new Uint8Array(body))
  }
  return { fetch, asked }
}
const raw = (repo: string, f: string) => `https://raw.githubusercontent.com/${repo}/HEAD/${f}`
const manifest = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: 'Ember',
    author: 'ana',
    version: '1.0.0',
    description: 'Warm and dark',
    modes: ['dark'],
    ...o
  })
const theme = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: 'Ember',
    mode: 'dark',
    colors: { bg: '#1a1210', text: '#f5e9e1', accent: '#ff7a45' },
    style: { radius: 'large' },
    ...o
  })

describe('community themes (#24)', () => {
  let dir: string
  beforeEach(() => {
    dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wg-ct-')), 'themes')
    fs.mkdirSync(dir)
  })
  afterEach(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }))

  const files = (extra: Record<string, string | Buffer> = {}) => ({
    [COMMUNITY_THEMES_URL]: JSON.stringify({
      themes: [{ repo: 'ana/ember' }, { repo: 'bob/broken' }, { repo: 'bad repo!/x' }]
    }),
    [raw('ana/ember', 'manifest.json')]: manifest(),
    [raw('ana/ember', 'wraithgrid-theme.json')]: theme(),
    [raw('ana/ember', 'screenshot.png')]: PNG,
    [raw('bob/broken', 'manifest.json')]: '{ nope',
    ...extra
  })

  it('lists themes with a valid manifest; bad entries and repos are left out', async () => {
    const f = fakeFetch(files())
    // The list itself refuses a bad repo name, so the whole list must be valid.
    const ok = fakeFetch({
      ...files(),
      [COMMUNITY_THEMES_URL]: JSON.stringify({
        themes: [{ repo: 'ana/ember' }, { repo: 'bob/broken' }]
      })
    })
    const c = new CommunityThemes({ fetch: ok.fetch, dir, appVersion: '1.15.0' })
    const r = await c.list()
    expect(r.themes).toEqual([
      expect.objectContaining({
        repo: 'ana/ember',
        name: 'Ember',
        author: 'ana',
        modes: ['dark'],
        installedId: null,
        update: false,
        tooNew: false
      })
    ])
    await expect(
      new CommunityThemes({ fetch: f.fetch, dir, appVersion: '1.15.0' }).list()
    ).rejects.toThrow(/community theme list/)
    // Only GitHub's raw host, over https.
    for (const u of [...f.asked, ...ok.asked])
      expect(u).toMatch(/^https:\/\/raw\.githubusercontent\.com\//)
  })

  it('installs, shows an update when the repo moves on, updates in place, removes', async () => {
    const all = files({
      [COMMUNITY_THEMES_URL]: JSON.stringify({ themes: [{ repo: 'ana/ember' }] })
    })
    let now = 0
    const f = fakeFetch(all)
    const c = new CommunityThemes({ fetch: f.fetch, dir, appVersion: '1.15.0', now: () => now })
    expect(await c.install('ana/ember')).toEqual({ ok: true, id: 'ember' })
    const listed = await listThemes(dir)
    expect(listed.themes[0]).toMatchObject({
      id: 'ember',
      author: 'ana',
      style: { radius: 'large' }
    })
    expect((await c.list()).themes[0]).toMatchObject({ installedId: 'ember', update: false })

    all[raw('ana/ember', 'manifest.json')] = manifest({ version: '1.1.0' })
    all[raw('ana/ember', 'wraithgrid-theme.json')] = theme({
      colors: { bg: '#000000', text: '#ffffff', accent: '#ff0000' }
    })
    now = 10 * 60_000
    expect((await c.list()).themes[0]).toMatchObject({
      update: true,
      version: '1.1.0',
      installedVersion: '1.0.0'
    })
    expect(await c.install('ana/ember')).toEqual({ ok: true, id: 'ember' })
    expect((await listThemes(dir)).themes[0]!.colors.accent).toBe('#ff0000')
    expect((await c.list()).themes[0]).toMatchObject({ update: false, installedVersion: '1.1.0' })

    expect(await c.uninstall('ember')).toBe(true)
    expect((await listThemes(dir)).themes).toEqual([])
    expect(await c.uninstall('ember')).toBe(false)
    // The lock file is not a theme file.
    expect((await listThemes(dir)).problems).toEqual([])
  })

  it('a bad or missing theme file says why and installs nothing', async () => {
    for (const [body, why] of [
      [theme({ style: { radius: 'huge' } }), /style.radius/],
      [theme({ mode: 'light' }), /manifest says dark/],
      [undefined, /missing/]
    ] as const) {
      const all = files()
      if (body === undefined) delete all[raw('ana/ember', 'wraithgrid-theme.json')]
      else all[raw('ana/ember', 'wraithgrid-theme.json')] = body
      const c = new CommunityThemes({ fetch: fakeFetch(all).fetch, dir, appVersion: '1.15.0' })
      const r = await c.install('ana/ember')
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(why)
      expect(fs.readdirSync(dir)).toEqual([])
    }
  })

  it('refuses a theme that needs a newer app, and odd repo names', async () => {
    const all = files({ [raw('ana/ember', 'manifest.json')]: manifest({ minAppVersion: '9.0.0' }) })
    const c = new CommunityThemes({ fetch: fakeFetch(all).fetch, dir, appVersion: '1.15.0' })
    const r = await c.install('ana/ember')
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/needs Wraithgrid 9.0.0/) })
    expect((await c.install('../etc')).ok).toBe(false)
  })

  it('a screenshot is shown only if it is a PNG', async () => {
    const c = new CommunityThemes({ fetch: fakeFetch(files()).fetch, dir, appVersion: '1.15.0' })
    expect(await c.screenshot('ana/ember')).toMatch(/^data:image\/png;base64,/)
    const bad = new CommunityThemes({
      fetch: fakeFetch(files({ [raw('ana/ember', 'screenshot.png')]: '<svg onload=x>' })).fetch,
      dir,
      appVersion: '1.15.0'
    })
    expect(await bad.screenshot('ana/ember')).toBeNull()
  })

  it('reads a repository from its address', () => {
    expect(repoFromUrl('https://github.com/ana/ember')).toBe('ana/ember')
    expect(repoFromUrl('https://github.com/ana/ember.git')).toBe('ana/ember')
    expect(repoFromUrl('https://github.com/ana/ember/tree/main')).toBe('ana/ember')
    expect(repoFromUrl('ana/ember')).toBe('ana/ember')
    expect(repoFromUrl('https://evil.example/ana/ember')).toBeNull()
    expect(repoFromUrl('http://github.com/ana/ember')).toBeNull()
    expect(newerVersion('1.10.0', '1.9.3')).toBe(true)
    expect(newerVersion('1.0.0', '1.0.0')).toBe(false)
  })
})
