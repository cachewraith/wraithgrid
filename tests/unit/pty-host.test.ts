import { chmod, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Duplex } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IPty } from '../support/node-host/pty-types'
import { FakePty, pipePair, tick } from './host-fixtures'
import type { PtyExitEvent } from '@shared/ipc-contract'
import { ensureHostDir, hostPaths } from '../../src/host/paths'
import {
  FrameReader,
  MAX_FRAME,
  PROTOCOL_VERSION,
  REPLAY_CHUNK,
  chunkReplay,
  encodeFrame
} from '../../src/host/protocol'
import type { KillPolicy, SpawnFn } from '../support/node-host/pty-manager'
import { HostServer } from '../support/node-host/server'
import { OlderHostKept, PaneHost } from '../../src/main/pane-host'

const req = (paneId: string) => ({
  paneId,
  file: '/bin/claude',
  args: [],
  cwd: '/tmp',
  env: {},
  cols: 80,
  rows: 24
})

describe('pty host', () => {
  let ptys: FakePty[]
  let server: HostServer
  let idle: number
  let shutdowns: number

  const killPolicy: KillPolicy = {
    soft: (p) => (p as unknown as FakePty).exit(0),
    hard: () => {},
    sweep: () => {}
  }

  beforeEach(() => {
    ptys = []
    idle = 0
    shutdowns = 0
    const spawn: SpawnFn = () => {
      const p = new FakePty()
      ptys.push(p)
      return p as unknown as IPty
    }
    server = new HostServer({
      spawn,
      token: 'secret',
      appVersion: '9.9.9',
      pid: 42,
      idleMs: 40,
      onIdle: () => idle++,
      onShutdown: () => shutdowns++,
      killPolicy,
      flushMs: 1
    })
  })

  /** A PaneHost wired straight to the in-memory server. */
  function client(
    events: { data: [string, string, boolean][]; exits: PtyExitEvent[] },
    token = 'secret'
  ): PaneHost {
    return new PaneHost({
      connect: async () => {
        const [a, b] = pipePair()
        server.accept(b)
        return a
      },
      start: async () => {},
      readToken: async () => token,
      appVersion: '9.9.9',
      onData: (paneId, data, replay) => events.data.push([paneId, data, replay]),
      onExit: (e) => events.exits.push(e),
      onMismatch: async () => 'keep',
      startTimeoutMs: 50,
      sleep: () => tick(5)
    })
  }

  const events = (): { data: [string, string, boolean][]; exits: PtyExitEvent[] } => ({
    data: [],
    exits: []
  })

  it('refuses a client with the wrong token', async () => {
    const host = client(events(), 'wrong')
    const r = await host.create(req('p1'))
    expect(r.ok).toBe(false)
    expect(ptys).toHaveLength(0)
  })

  it('streams output to the creating client and forwards input', async () => {
    const ev = events()
    const host = client(ev)
    const r = await host.create(req('p1'))
    expect(r).toEqual({ ok: true, pid: ptys[0]!.pid })
    ptys[0]!.emit('hello')
    await tick()
    expect(ev.data).toEqual([['p1', 'hello', false]])
    host.write('p1', 'ls\r')
    await tick()
    expect(ptys[0]!.written).toEqual(['ls\r'])
  })

  it('a second GUI reattaches with the screen, then gets live output once', async () => {
    const first = client(events())
    await first.create(req('p1'))
    ptys[0]!.emit('\x1b[31mred line\x1b[0m\r\nsecond line')
    await tick()
    await first.detach()

    const ev = events()
    const second = client(ev)
    const kept = await second.attach('p1', 100, 30)
    expect(kept).toEqual({ pid: ptys[0]!.pid, exit: null })
    expect(ptys[0]!.size).toEqual({ cols: 100, rows: 30 })
    expect(ev.data).toHaveLength(1)
    const [paneId, snapshot, replay] = ev.data[0]!
    expect([paneId, replay]).toEqual(['p1', true])
    expect(snapshot).toContain('red line')
    expect(snapshot).toContain('second line')

    ptys[0]!.emit('live')
    await tick()
    expect(ev.data.slice(1)).toEqual([['p1', 'live', false]])
  })

  it('sends a screen over 4 MB in pieces the window can read (#134)', async () => {
    // Densely coloured: every ESC becomes six characters in JSON, so one frame would be ~7 MB.
    const big = '\x1b[41mx'.repeat(600_000)
    expect(encodeFrame({ t: 'data', paneId: 'p1', data: big }).length).toBeGreaterThan(MAX_FRAME)
    server = new HostServer({
      spawn: () => {
        const p = new FakePty()
        ptys.push(p)
        return p as unknown as IPty
      },
      token: 'secret',
      appVersion: '9.9.9',
      pid: 42,
      idleMs: 40,
      onIdle: () => idle++,
      onShutdown: () => shutdowns++,
      killPolicy,
      flushMs: 1,
      screen: () => ({
        write: () => {},
        resize: () => {},
        serialize: async () => big,
        text: async () => '',
        dispose: () => {}
      })
    })
    const first = client(events())
    await first.create(req('p1'))
    await first.detach()

    const ev = events()
    const second = client(ev)
    expect(await second.attach('p1', 80, 24)).toEqual({ pid: ptys[0]!.pid, exit: null })
    const parts = ev.data.filter(([, , replay]) => replay)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.map(([, data]) => data).join('')).toBe(big)
    expect(ev.exits).toEqual([])
    // Still connected: live output follows.
    ptys[0]!.emit('live')
    await tick()
    expect(ev.data.at(-1)).toEqual(['p1', 'live', false])
  })

  it('keeps a pane that ended while nobody watched, until it is attached', async () => {
    const first = client(events())
    await first.create(req('p1'))
    ptys[0]!.emit('last words')
    await tick()
    await first.detach()
    await tick()
    ptys[0]!.exit(3)
    await tick()

    const ev = events()
    const second = client(ev)
    const kept = await second.attach('p1', 80, 24)
    expect(kept?.exit).toEqual({ exitCode: 3, signal: null })
    expect(ev.data[0]![1]).toContain('last words')
    // Delivered once: a later attach finds nothing.
    expect(await second.attach('p1', 80, 24)).toBeNull()
  })

  it('reports an exit to the attached client and stops a pane on kill without one', async () => {
    const ev = events()
    const host = client(ev)
    await host.create(req('p1'))
    await host.create(req('p2'))
    ptys[0]!.exit(1)
    await tick()
    expect(ev.exits).toEqual([{ paneId: 'p1', exitCode: 1, signal: null }])
    host.kill('p2')
    await tick()
    expect(ev.exits).toHaveLength(1)
    expect(await host.liveCount()).toBe(0)
  })

  it('counts live panes and stops them all on shutdown', async () => {
    const host = client(events())
    await host.create(req('p1'))
    await host.create(req('p2'))
    expect(await host.liveCount()).toBe(2)
    await host.stopAll()
    expect(shutdowns).toBe(1)
    expect(server.liveCount).toBe(0)
  })

  it('tells the GUI its panes ended when the host goes away', async () => {
    const ev = events()
    let sock: Duplex | null = null
    const host = new PaneHost({
      connect: async () => {
        const [a, b] = pipePair()
        server.accept(b)
        sock = a
        return a
      },
      start: async () => {},
      readToken: async () => 'secret',
      appVersion: '9.9.9',
      onData: () => {},
      onExit: (e) => ev.exits.push(e),
      onMismatch: async () => 'keep'
    })
    await host.create(req('p1'))
    sock!.destroy()
    await tick()
    expect(ev.exits).toEqual([
      { paneId: 'p1', exitCode: -1, signal: null, error: 'The background host stopped.' }
    ])
  })

  it('exits when idle: no client and no live pane', async () => {
    await tick(60)
    expect(idle).toBe(1)
    const host = client(events())
    await host.create(req('p1'))
    await tick(60)
    expect(idle).toBe(1)
  })
})

describe('pane host start and versions', () => {
  /** A fake host speaking another protocol version. */
  function oldHost(live: number): { connect: () => Promise<Duplex>; shutdowns: number } {
    const state = { shutdowns: 0, connect: async (): Promise<Duplex> => a }
    const [a, b] = pipePair()
    const reader = new FrameReader(
      (raw) => {
        const f = raw as { t: string; id: number }
        if (f.t === 'hello')
          b.write(
            encodeFrame({
              t: 'welcome',
              protocol: PROTOCOL_VERSION + 1,
              appVersion: '0.1.0',
              pid: 1
            })
          )
        if (f.t === 'list') {
          const panes = Array.from({ length: live }, (_, i) => ({
            paneId: `p${i}`,
            pid: i,
            exit: null,
            state: 'idle' as const
          }))
          b.write(encodeFrame({ t: 'reply', id: f.id, reply: { ok: true, panes } }))
        }
        if (f.t === 'shutdown') state.shutdowns++
      },
      () => {}
    )
    b.on('data', (c) => reader.push(String(c)))
    return state
  }

  it('starts a host when nothing listens, then connects', async () => {
    let started = 0
    const host = new PaneHost({
      connect: async () => {
        throw new Error('ENOENT')
      },
      start: async () => {
        started++
      },
      readToken: async () => 't',
      appVersion: '1',
      onData: () => {},
      onExit: () => {},
      onMismatch: async () => 'keep',
      startTimeoutMs: 30,
      sleep: () => tick(5)
    })
    const r = await host.create(req('p1'))
    expect(started).toBe(1)
    expect(r).toEqual({ ok: false, error: 'ENOENT' })
  })

  it('leaves an older host running when the user keeps its agents', async () => {
    const old = oldHost(2)
    let asked = 0
    let started = 0
    const host = new PaneHost({
      connect: old.connect,
      start: async () => {
        started++
      },
      readToken: async () => 't',
      appVersion: '1',
      onData: () => {},
      onExit: () => {},
      onMismatch: async (info) => {
        asked = info.live
        return 'keep'
      }
    })
    const r = await host.create(req('p1'))
    expect(asked).toBe(2)
    expect(started).toBe(0)
    expect(old.shutdowns).toBe(0)
    expect(r.ok).toBe(false)
    expect(OlderHostKept).toBeDefined()
  })
})

describe('host paths', () => {
  const base = { tmpDir: '/tmp', uid: 1000, userName: 'me' }

  it('puts the socket in XDG_RUNTIME_DIR, one per user-data dir', () => {
    const a = hostPaths({
      ...base,
      platform: 'linux',
      env: { XDG_RUNTIME_DIR: '/run/user/1000' },
      userData: '/home/me/.config/wraithgrid'
    })
    const b = hostPaths({
      ...base,
      platform: 'linux',
      env: { XDG_RUNTIME_DIR: '/run/user/1000' },
      userData: '/tmp/e2e-1'
    })
    expect(a.socket).toMatch(/^\/run\/user\/1000\/wraithgrid-1000-[0-9a-f]{12}\/host\.sock$/)
    expect(a.socket).not.toBe(b.socket)
    expect(a.token.startsWith(a.dir)).toBe(true)
  })

  it('falls back to the temp dir and keeps macOS socket paths short', () => {
    const p = hostPaths({
      ...base,
      platform: 'darwin',
      env: {},
      tmpDir: '/var/folders/xy/abcdefghijklmnopqrstuvwx0000gn/T',
      userData: '/Users/me/Library/Application Support/wraithgrid'
    })
    expect(p.socket.startsWith('/var/folders/')).toBe(true)
    expect(Buffer.byteLength(p.socket)).toBeLessThan(104)
  })

  it('uses a named pipe on Windows', () => {
    const p = hostPaths({
      ...base,
      platform: 'win32',
      env: {},
      uid: -1,
      userData: 'C:\\Users\\me\\AppData\\Roaming\\wraithgrid'
    })
    expect(p.socket).toMatch(/^\\\\\.\\pipe\\wraithgrid-host-[0-9a-f]{12}$/)
    expect(p.token).toBe('C:\\Users\\me\\AppData\\Roaming\\wraithgrid\\run\\host.token')
  })

  describe.skipIf(process.platform === 'win32')('host dir', () => {
    let tmp: string
    beforeEach(async () => {
      tmp = await mkdtemp(path.join(os.tmpdir(), 'wg-host-'))
    })
    afterEach(async () => {
      await rm(tmp, { recursive: true, force: true })
    })

    it('creates it user-only and refuses one open to others', async () => {
      const uid = process.getuid!()
      const dir = path.join(tmp, 'run')
      await ensureHostDir(dir, process.platform, uid)
      await chmod(dir, 0o755)
      await expect(ensureHostDir(dir, process.platform, uid)).rejects.toThrow(/open to other users/)
      await expect(ensureHostDir(dir, process.platform, uid + 1)).rejects.toThrow(/another user/)
    })
  })
})

describe('host frames (#134)', () => {
  it('splits a replay into pieces under the frame limit, never inside a surrogate pair', () => {
    expect(chunkReplay('')).toEqual([])
    expect(chunkReplay('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
    const emoji = String.fromCodePoint(0x1f600)
    expect(chunkReplay(`ab${emoji}cd`, 3)).toEqual(['ab', `${emoji}c`, 'd'])
    const dense = '\x1b'.repeat(REPLAY_CHUNK * 2)
    for (const part of chunkReplay(dense))
      expect(encodeFrame({ t: 'data', paneId: 'p', data: part, replay: true }).length).toBeLessThan(
        MAX_FRAME
      )
  })

  it('reads a large frame arriving in small chunks, once per byte', () => {
    const frames: unknown[] = []
    const reader = new FrameReader(
      (f) => frames.push(f),
      (e) => {
        throw new Error(e)
      }
    )
    const line = encodeFrame({ t: 'data', paneId: 'p', data: 'y'.repeat(3_000_000) })
    const started = performance.now()
    for (let i = 0; i < line.length; i += 1024) reader.push(line.slice(i, i + 1024))
    expect(frames).toHaveLength(1)
    // Rescanning a growing string took ~1.5 s here; one pass over the chunks is milliseconds.
    expect(performance.now() - started).toBeLessThan(500)
    reader.push('{"t":"a"}\n{"t":"b"}\n')
    expect(frames).toHaveLength(3)
  })
})
