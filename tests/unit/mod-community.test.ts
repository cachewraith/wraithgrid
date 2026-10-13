import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_URL,
  CommunityCatalog,
  communityMod,
  parseCommunityPage
} from '../../src/main/mod-community'

// The site ships its data as JSON inside a script string, so every quote is escaped.
const card = (slug: string, githubUrl: string, githubStars: unknown = 12): string =>
  `["$","$L37",null,${JSON.stringify({ modId: 'x', githubStars, githubUrl, slug })}]`.replace(
    /"/g,
    '\\"'
  )
const page = `<html><script>self.__next_f.push([1,"${[
  card('burn-meter', 'https://github.com/OneWave-AI/claude-code-mods', 13),
  card('cctop', 'https://github.com/tomstagl/cctop.git', null),
  card('burn-meter', 'https://github.com/other/copy'),
  card('elsewhere', 'https://gitlab.com/a/b'),
  card('option', 'https://github.com/--upload-pack=x/y'),
  card('deep', 'https://github.com/a/b/tree/main/c')
].join(',')}"])</script></html>`

describe('claudemod.com list', () => {
  it('reads the GitHub repositories the page names, once per mod', () => {
    expect(parseCommunityPage(page)).toEqual([
      { slug: 'burn-meter', repo: 'OneWave-AI/claude-code-mods', stars: 13 },
      { slug: 'cctop', repo: 'tomstagl/cctop', stars: null }
    ])
    expect(parseCommunityPage('<html>nothing</html>')).toEqual([])
  })

  const entry = { slug: 'burn-meter', repo: 'OneWave-AI/claude-code-mods', stars: 13 }

  it('offers the mod named like the entry, or the only one of the marketplace', () => {
    const many = {
      name: 'claude-code-mods',
      plugins: [
        { name: 'code-pet', source: './code-pet' },
        { name: 'burn-meter', description: ' Live  cost\n odometer ', version: '1.0.0' }
      ]
    }
    expect(communityMod(entry, many)).toEqual({
      mod: {
        id: 'burn-meter@claude-code-mods',
        name: 'burn-meter',
        description: 'Live cost odometer',
        marketplace: 'claude-code-mods',
        version: '1.0.0',
        installs: null,
        stars: 13,
        url: 'https://github.com/OneWave-AI/claude-code-mods'
      },
      marketplace: {
        name: 'claude-code-mods',
        url: 'https://github.com/OneWave-AI/claude-code-mods',
        add: 'OneWave-AI/claude-code-mods'
      }
    })
    const one = { name: 'flightdeck-market', plugins: [{ name: 'flightdeck' }] }
    expect(communityMod(entry, one)?.mod.id).toBe('flightdeck@flightdeck-market')
  })

  it('offers nothing it could not install safely', () => {
    const none = { name: 'm', plugins: [{ name: 'a' }, { name: 'b' }] }
    expect(communityMod(entry, none)).toBeNull()
    expect(communityMod(entry, { name: '--scope', plugins: [{ name: 'burn-meter' }] })).toBeNull()
    expect(communityMod(entry, { name: 'm', plugins: [{ name: 'a b; rm' }] })).toBeNull()
    expect(communityMod(entry, { name: 'a@b', plugins: [{ name: 'burn-meter' }] })).toBeNull()
    expect(communityMod(entry, { plugins: [] })).toBeNull()
    expect(communityMod(entry, 'junk')).toBeNull()
  })

  it('fetches the page and each repository once, then reuses the answer', async () => {
    const asked: string[] = []
    let now = 0
    const catalog = new CommunityCatalog(
      (url) => {
        asked.push(url)
        if (url === COMMUNITY_URL) return Promise.resolve(new Response(page))
        if (url.includes('/tomstagl/cctop/'))
          return Promise.resolve(
            new Response(JSON.stringify({ name: 'cctop', plugins: [{ name: 'cctop' }] }))
          )
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      },
      () => now
    )
    const first = await catalog.read()
    expect(first.mods.map((m) => m.id)).toEqual(['cctop@cctop'])
    expect(first.marketplaces).toEqual([
      { name: 'cctop', url: 'https://github.com/tomstagl/cctop', add: 'tomstagl/cctop' }
    ])
    expect(asked).toEqual([
      COMMUNITY_URL,
      'https://raw.githubusercontent.com/OneWave-AI/claude-code-mods/HEAD/.claude-plugin/marketplace.json',
      'https://raw.githubusercontent.com/tomstagl/cctop/HEAD/.claude-plugin/marketplace.json'
    ])
    await catalog.read()
    expect(asked).toHaveLength(3)
    now = 6 * 60_000
    await catalog.read()
    expect(asked).toHaveLength(6)
  })

  it('says so when the site cannot be read', async () => {
    const down = new CommunityCatalog(() => Promise.reject(new Error('offline')))
    await expect(down.read()).rejects.toThrow('Could not reach claudemod.com')
    const empty = new CommunityCatalog(() => Promise.resolve(new Response('<html></html>')))
    await expect(empty.read()).rejects.toThrow('listed no mods')
  })
})
