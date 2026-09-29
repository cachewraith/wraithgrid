import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, migrateConfig, parseConfig } from '@shared/schema'
import type { Config } from '@shared/types'
import { ConfigStore, writeFileAtomic } from '../../src/main/config-store'

const sample = (): Config => ({
  ...defaultConfig(),
  accounts: [
    {
      id: 'a1',
      name: 'personal',
      configDir: '~/.claude',
      color: '#7c5cff',
      signedIn: true,
      imported: true
    }
  ],
  workspaces: [
    {
      id: 'ws1',
      name: 'default',
      panes: [
        { id: 'p1', accountId: 'a1', cwd: '~/proj', args: ['-c'], shell: false, title: 'proj' }
      ],
      layout: { type: 'pane', paneId: 'p1' }
    }
  ],
  activeWorkspace: 'ws1'
})

describe('config schema', () => {
  it('accepts a valid config unchanged', () => {
    const cfg = sample()
    expect(parseConfig(JSON.parse(JSON.stringify(cfg)))).toEqual({ ok: true, config: cfg })
  })

  it('fills defaults for missing optional fields', () => {
    const raw = JSON.parse(JSON.stringify(sample()))
    delete raw.settings
    delete raw.recentFolders
    const r = parseConfig(raw)
    expect(r.ok && r.config.settings.fontSize).toBe(13)
    expect(r.ok && r.config.recentFolders).toEqual([])
  })

  it('gives a 1.0 config the new appearance and update settings', () => {
    const raw = JSON.parse(JSON.stringify(sample()))
    raw.settings = { fontSize: 14, theme: 'light' }
    const r = parseConfig(raw)
    expect(r.ok && r.config.settings).toMatchObject({
      fontSize: 14,
      theme: 'light',
      accent: 'violet',
      terminalPalette: 'match',
      checkUpdatesOnLaunch: true
    })
  })

  it('accepts the system theme and rejects unknown appearance values', () => {
    const withSettings = (patch: object) => ({
      ...sample(),
      settings: { ...sample().settings, ...patch }
    })
    expect(parseConfig(withSettings({ theme: 'system' })).ok).toBe(true)
    expect(parseConfig(withSettings({ theme: 'sepia' })).ok).toBe(false)
    expect(parseConfig(withSettings({ accent: 'chartreuse' })).ok).toBe(false)
    expect(parseConfig(withSettings({ terminalPalette: 'url(x)' })).ok).toBe(false)
  })

  it('rejects bad values', () => {
    const bad = { ...sample(), settings: { ...sample().settings, fontSize: 99 } }
    expect(parseConfig(bad).ok).toBe(false)
    expect(parseConfig({ ...sample(), workspaces: [] }).ok).toBe(false)
    expect(
      parseConfig({
        ...sample(),
        accounts: [{ id: '../x', name: 'x', configDir: '~', color: '#7c5cff' }]
      }).ok
    ).toBe(false)
    expect(parseConfig('nope').ok).toBe(false)
    expect(parseConfig({ ...sample(), version: 99 }).ok).toBe(false)
    expect(parseConfig({ nope: true }).ok).toBe(false)
  })

  it('rejects split nodes whose sizes do not match their children', () => {
    const cfg = sample()
    cfg.workspaces[0]!.layout = {
      type: 'split',
      dir: 'row',
      sizes: [100],
      children: [
        { type: 'pane', paneId: 'p1' },
        { type: 'empty', slotId: 's1' }
      ]
    }
    expect(parseConfig(cfg).ok).toBe(false)
  })

  it('repairs dangling references', () => {
    const cfg = sample()
    cfg.activeWorkspace = 'gone'
    cfg.settings.defaultAccountId = 'gone'
    cfg.workspaces[0]!.panes[0]!.accountId = 'gone'
    const r = parseConfig(cfg)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.activeWorkspace).toBe('ws1')
    expect(r.config.settings.defaultAccountId).toBeNull()
    expect(r.config.workspaces[0]!.panes[0]!.accountId).toBeNull()
  })

  it('migrates the unversioned requirements §9 shape', () => {
    const v0 = {
      claudePath: 'claude',
      accounts: [
        {
          id: 'a1',
          name: 'personal',
          configDir: '~/.wraithgrid/accounts/personal',
          color: '#7c5cff'
        }
      ],
      workspaces: [
        {
          name: 'default',
          panes: [{ id: 'p1', accountId: 'a1', cwd: '~/proj1', args: [] }],
          layout: {}
        }
      ],
      settings: { fontSize: 13, theme: 'dark' }
    }
    const migrated = migrateConfig(v0) as Config
    expect(migrated.version).toBe(1)
    const r = parseConfig(v0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.claudePath).toBe('')
    expect(r.config.accounts[0]).toMatchObject({ signedIn: true, imported: false })
    expect(r.config.workspaces[0]).toMatchObject({ id: 'ws-1', name: 'default', layout: null })
    expect(r.config.workspaces[0]!.panes[0]).toMatchObject({ title: 'proj1', shell: false })
  })
})

describe('ConfigStore', () => {
  let dir: string
  let file: string
  const quiet = (): void => {}

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraithgrid-test-'))
    file = path.join(dir, 'config.json')
  })
  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('starts from defaults when the file is missing', () => {
    const store = new ConfigStore(file, { log: quiet })
    expect(store.load()).toEqual(defaultConfig())
  })

  it('backs up a corrupt file and starts fresh', () => {
    fs.writeFileSync(file, '{ not json')
    const store = new ConfigStore(file, {
      log: quiet,
      now: () => new Date('2026-09-29T10:00:00.000Z')
    })
    expect(store.load()).toEqual(defaultConfig())
    expect(fs.existsSync(file)).toBe(false)
    const backup = path.join(dir, 'config.bad-2026-09-29T10-00-00-000Z.json')
    expect(fs.readFileSync(backup, 'utf8')).toBe('{ not json')
  })

  it('backs up a file that fails validation', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, accounts: 'x' }))
    const store = new ConfigStore(file, { log: quiet })
    expect(store.load()).toEqual(defaultConfig())
    expect(fs.readdirSync(dir).some((f) => f.startsWith('config.bad-'))).toBe(true)
  })

  it('refuses invalid input from set() and keeps the old config', () => {
    const store = new ConfigStore(file, { log: quiet })
    store.load()
    expect(store.set({ nope: true }).ok).toBe(false)
    // An unversioned §9-shaped object is only migrated from disk, never over IPC.
    expect(store.set({ accounts: [], workspaces: [] }).ok).toBe(false)
    expect(store.get()).toEqual(defaultConfig())
  })

  it('debounces writes and flushes on demand', async () => {
    vi.useFakeTimers()
    const store = new ConfigStore(file, { debounceMs: 300, log: quiet })
    store.load()
    store.set(sample())
    store.set({ ...sample(), recentFolders: ['~/a'] })
    expect(fs.existsSync(file)).toBe(false)
    vi.useRealTimers()
    await store.flush()
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(saved.recentFolders).toEqual(['~/a'])
    // A reload reads back exactly what was saved.
    expect(new ConfigStore(file, { log: quiet }).load()).toEqual(store.get())
  })

  it('writes atomically without leaving temp files', async () => {
    await writeFileAtomic(file, '{"a":1}')
    await writeFileAtomic(file, '{"a":2}')
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: 2 })
    expect(fs.readdirSync(dir)).toEqual(['config.json'])
  })
})
