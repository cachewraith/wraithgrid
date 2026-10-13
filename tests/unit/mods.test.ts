import { describe, expect, it } from 'vitest'
import type { AccountMods, CatalogMod, ModInfo } from '../../src/shared/ipc-contract'
import {
  lastLine,
  listMods,
  marketplaceAddArgs,
  modInstallArgs,
  modToggleArgs,
  parseMarketplaces,
  parseModCatalog,
  parseModList,
  withModLinks
} from '../../src/main/mods'
import {
  formatInstalls,
  mergeMods,
  searchMods,
  uniqueMods
} from '../../src/renderer/lib/mod-catalog'
import { Osc99Reader, osc52Text, osc777Notice, osc9Notice } from '../../src/renderer/lib/term-osc'

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')

describe('parseModList', () => {
  const listed = JSON.stringify([
    { id: 'tally@acme', version: '0.2.0', scope: 'user', enabled: true, installPath: '/x' },
    { id: 'tally@acme', version: '0.2.0', scope: 'project', enabled: false, projectPath: '/p' },
    { id: 'eng@synced', scope: 'synced', enabled: true, notes: ['shadowed', 'x'.repeat(900)] },
    { id: '--all', version: '1', scope: 'user', enabled: true },
    { version: '1' },
    'junk'
  ])

  it('keeps the fields the view shows and skips what is not a mod', () => {
    const mods = parseModList(listed)
    expect(mods.map((m) => [m.id, m.scope, m.enabled, m.projectPath])).toEqual([
      ['tally@acme', 'user', true, null],
      ['tally@acme', 'project', false, '/p'],
      ['eng@synced', 'synced', true, null]
    ])
    expect(mods[2]).toMatchObject({ version: 'unknown' })
    expect(mods[2]!.notes[1]).toHaveLength(300)
  })

  it('reads past text printed before the list and rejects output without one', () => {
    expect(parseModList(`warning: slow disk\n${listed}`)).toHaveLength(3)
    expect(() => parseModList('not logged in')).toThrow()
    expect(() => parseModList('{"a":1}')).toThrow()
  })

  it('asks the given claude for the list', async () => {
    const calls: string[][] = []
    const mods = await listMods(
      (args) => {
        calls.push(args)
        return Promise.resolve('[]')
      },
      {},
      '/home/tester'
    )
    expect(mods).toEqual([])
    expect(calls).toEqual([['plugin', 'list', '--json']])
  })
})

describe('modToggleArgs', () => {
  it('names the scope only where claude takes one', () => {
    expect(modToggleArgs({ id: 'tally@acme', scope: 'user' }, false)).toEqual([
      'plugin',
      'disable',
      'tally@acme',
      '--scope',
      'user'
    ])
    expect(modToggleArgs({ id: 'eng@synced', scope: 'synced' }, true)).toEqual([
      'plugin',
      'enable',
      'eng@synced'
    ])
  })

  it('refuses an id that would read as an option or carry shell characters', () => {
    expect(modToggleArgs({ id: '--all', scope: 'user' }, false)).toBeNull()
    expect(modToggleArgs({ id: 'a&calc@x', scope: 'user' }, false)).toBeNull()
  })
})

describe('lastLine', () => {
  it('is the last non-empty line, or null', () => {
    expect(lastLine('a\nPlugin not found\n\n')).toBe('Plugin not found')
    expect(lastLine(' \n')).toBeNull()
  })
})

describe('terminal requests from a pane', () => {
  it('OSC 52 copies text and never answers a read', () => {
    expect(osc52Text(`c;${b64('héllo ✓')}`)).toBe('héllo ✓')
    expect(osc52Text(`;${b64('x')}`)).toBe('x')
    expect(osc52Text('c;?')).toBeNull()
    expect(osc52Text('c;')).toBeNull()
    expect(osc52Text('c;%%%')).toBeNull()
    expect(osc52Text('nope')).toBeNull()
  })

  it('OSC 9 is a message, with a title line when there is one', () => {
    expect(osc9Notice('Build done')).toEqual({ title: '', body: 'Build done' })
    expect(osc9Notice('\n\ntally:\nBuild done')).toEqual({ title: 'tally', body: 'Build done' })
    expect(osc9Notice('4;1;50')).toBeNull() // progress bar, not a notification
    expect(osc9Notice('')).toBeNull()
  })

  it('OSC 777 is notify;title;body', () => {
    expect(osc777Notice('notify;tally;3 files; 2 left')).toEqual({
      title: 'tally',
      body: '3 files; 2 left'
    })
    expect(osc777Notice('precmd;x')).toBeNull()
  })

  it('OSC 99 joins the parts of one notification', () => {
    const r = new Osc99Reader()
    expect(r.feed('i=7:d=0:p=title;tally')).toBeNull()
    expect(r.feed(`i=7:d=0:p=body:e=1;${b64('Build ')}`)).toBeNull()
    expect(r.feed('i=7:d=1:p=body;done')).toEqual({ title: 'tally', body: 'Build done' })
    expect(r.feed('i=8;plain title')).toEqual({ title: 'plain title', body: '' })
    expect(r.feed('i=7:p=close;')).toBeNull()
  })

  it('strips control characters and caps the length', () => {
    expect(osc9Notice('a\x1b[31mb\x07')).toEqual({ title: '', body: 'a [31mb' })
    expect(osc777Notice(`notify;${'t'.repeat(500)};b`)?.title).toHaveLength(120)
  })
})

describe('mod catalog', () => {
  const printed = JSON.stringify({
    installed: [],
    available: [
      {
        pluginId: 'clock@acme',
        name: 'clock',
        description: ' A clock\n above the prompt ',
        marketplaceName: 'acme',
        version: '1.1.0',
        installCount: 4520,
        source: { source: 'url', url: 'https://example.com/clock.git' }
      },
      { pluginId: 'weather@acme', name: 'weather', marketplaceName: 'acme', source: './weather' },
      { pluginId: 'ssh@acme', name: 'ssh', source: { url: 'ssh://git@example.com/x' } },
      { pluginId: '-y', name: 'bad', source: '.' },
      { name: 'no id' }
    ]
  })

  it('keeps what the list shows and skips entries that are not installable', () => {
    expect(parseModCatalog(`note\n${printed}`)).toEqual([
      {
        id: 'clock@acme',
        name: 'clock',
        description: 'A clock above the prompt',
        marketplace: 'acme',
        version: '1.1.0',
        installs: 4520,
        stars: null,
        url: 'https://example.com/clock'
      },
      {
        id: 'weather@acme',
        name: 'weather',
        description: '',
        marketplace: 'acme',
        version: null,
        installs: null,
        stars: null,
        url: null
      },
      {
        id: 'ssh@acme',
        name: 'ssh',
        description: '',
        marketplace: '',
        version: null,
        installs: null,
        stars: null,
        url: null
      }
    ])
    expect(() => parseModCatalog('[]')).toThrow()
    expect(() => parseModCatalog('{"installed":[]}')).toThrow()
  })

  it('installs for the account, never an id that reads as an option', () => {
    expect(modInstallArgs('clock@acme')).toEqual([
      'plugin',
      'install',
      'clock@acme',
      '--scope',
      'user'
    ])
    expect(modInstallArgs('--yes')).toBeNull()
  })

  const mod = (name: string, extra: Partial<CatalogMod> = {}): CatalogMod => ({
    id: `${name}@acme`,
    name,
    description: '',
    marketplace: 'acme',
    version: null,
    installs: null,
    stars: null,
    url: null,
    ...extra
  })
  const mods = [
    mod('status-clock', { installs: 10 }),
    mod('clock', { installs: 5 }),
    mod('clock', { id: 'clock@mirror', marketplace: 'mirror' }),
    mod('weather', { installs: 900, description: 'Forecast and a clock' }),
    mod('tally', { installs: 50 })
  ]

  it('shows one listing per mod, the one with installs', () => {
    expect(uniqueMods(mods).map((m) => m.id)).toEqual([
      'status-clock@acme',
      'clock@acme',
      'weather@acme',
      'tally@acme'
    ])
  })

  it('lists the most installed first, and ranks a name match over a description match', () => {
    expect(searchMods(mods, '').map((m) => m.name)).toEqual([
      'weather',
      'tally',
      'status-clock',
      'clock'
    ])
    expect(searchMods(mods, ' Clock ').map((m) => m.name)).toEqual([
      'clock',
      'status-clock',
      'weather'
    ])
    expect(searchMods(mods, 'status clock').map((m) => m.name)).toEqual(['status-clock'])
    expect(searchMods(mods, 'statusclock').map((m) => m.name)).toEqual(['status-clock'])
    expect(searchMods([mod('statusline')], 'status line')).toHaveLength(1)
    expect(searchMods(mods, 'nothing')).toEqual([])
  })

  it('links a mod to its repository, and to its folder there', () => {
    const markets = parseMarketplaces(
      `note\n${JSON.stringify([
        { name: 'acme', source: 'github', repo: 'acme/mods', installLocation: '/x' },
        { name: 'git', source: 'git', url: 'https://git.example.com/mods.git' },
        { name: 'local', source: 'directory', path: '/home/me/mods' },
        { name: 'odd', source: 'github', repo: '--upload-pack=x' }
      ])}`
    )
    expect(markets).toEqual([
      { name: 'acme', url: 'https://github.com/acme/mods', add: 'acme/mods' },
      {
        name: 'git',
        url: 'https://git.example.com/mods',
        add: 'https://git.example.com/mods.git'
      },
      { name: 'local', url: null, add: null },
      { name: 'odd', url: null, add: null }
    ])
    const entry = (name: string, marketplaceName: string, source: unknown): unknown => ({
      pluginId: `${name}@${marketplaceName}`,
      name,
      marketplaceName,
      source
    })
    const sub = { source: 'git-subdir', url: 'https://github.com/o/r.git', path: 'plugins/a b' }
    const urls = parseModCatalog(
      JSON.stringify({
        available: [
          entry('inside', 'acme', './plugins/inside'),
          entry('root', 'acme', './'),
          entry('up', 'acme', '../../etc'),
          entry('elsewhere', 'git', './x'),
          entry('homeless', 'local', './x'),
          entry('sub', 'acme', { ...sub, ref: 'v1.5.5', sha: 'abc' }),
          entry('sub-head', 'acme', sub),
          entry('sub-odd', 'acme', { ...sub, ref: 'a b?' })
        ]
      }),
      markets
    ).map((m) => m.url)
    expect(urls).toEqual([
      'https://github.com/acme/mods/tree/HEAD/plugins/inside',
      'https://github.com/acme/mods',
      'https://github.com/acme/mods',
      'https://git.example.com/mods',
      null,
      'https://github.com/o/r/tree/v1.5.5/plugins/a%20b',
      'https://github.com/o/r/tree/HEAD/plugins/a%20b',
      'https://github.com/o/r/tree/HEAD/plugins/a%20b'
    ])
    const [tally, synced] = withModLinks(
      parseModList('[{"id":"tally@acme","scope":"user"},{"id":"eng@synced","scope":"synced"}]'),
      markets
    )
    expect([tally!.url, synced!.url]).toEqual(['https://github.com/acme/mods', null])
  })

  it('adds a marketplace by repo or https address only', () => {
    expect(marketplaceAddArgs('acme/mods')).toEqual(['plugin', 'marketplace', 'add', 'acme/mods'])
    expect(marketplaceAddArgs('https://git.example.com/mods.git')).toHaveLength(4)
    expect(marketplaceAddArgs('--scope')).toBeNull()
    expect(marketplaceAddArgs('/home/me/mods')).toBeNull()
    expect(marketplaceAddArgs('ssh://git@example.com/x')).toBeNull()
  })

  it('reads the accounts as one list', () => {
    const one = (id: string, extra: Partial<ModInfo> = {}): ModInfo => ({
      id,
      version: '1',
      scope: 'user',
      enabled: true,
      projectPath: null,
      url: null,
      notes: [],
      ...extra
    })
    const results: AccountMods[] = [
      { accountId: 'a', ok: true, mods: [one('tally@acme'), one('clock@acme')] },
      {
        accountId: 'b',
        ok: true,
        mods: [one('tally@acme', { enabled: false, url: 'https://x.test/' })]
      },
      { accountId: 'c', ok: false, error: 'not signed in' }
    ]
    expect(
      mergeMods(results).map((r) => [r.mod.id, r.mod.enabled, r.accounts, r.on, r.missing])
    ).toEqual([
      ['tally@acme', false, ['a', 'b'], ['a'], []],
      ['clock@acme', true, ['a'], ['a'], ['b']]
    ])
    expect(mergeMods(results)[0]!.mod.url).toBe('https://x.test/')
    expect(mergeMods([])).toEqual([])
  })

  it('shortens install counts', () => {
    expect([12, 4520, 45_200, 1_290_640].map(formatInstalls)).toEqual(['12', '4.5k', '45k', '1.3M'])
  })
})
