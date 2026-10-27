import { PassThrough, Writable } from 'node:stream'
import { beforeEach, describe, expect, it } from 'vitest'
import type { IPty } from '../support/node-host/pty-types'
import type { PtyExitEvent } from '@shared/ipc-contract'
import { parseConfig } from '@shared/schema'
import type { Machine } from '@shared/types'
import type { SpawnRequest } from '../../src/host/protocol'
import type { KillPolicy, SpawnFn } from '../support/node-host/pty-manager'
import { HostServer } from '../support/node-host/server'
import { runBridge } from '../../src/main/host-bridge'
import { PaneHost } from '../../src/main/pane-host'
import { PaneRouter } from '../../src/main/pane-router'
import type { SpawnSpec } from '../../src/main/spawn-resolve'
import { sshArgs, sshConfigHosts } from '../../src/main/ssh'
import { FakePty, pipePair, tick } from './host-fixtures'

describe('ssh config hosts', () => {
  it('lists Host names, without patterns or comments', () => {
    const text = [
      '# work machines',
      'Host build gpu-box  # two at once',
      '  HostName 10.0.0.5',
      'Host *.internal',
      'host lab',
      'Host !bad -oProxyCommand=x',
      'Match host foo'
    ].join('\n')
    expect(sshConfigHosts(text)).toEqual(['build', 'gpu-box', 'lab'])
  })

  it('ends ssh options before the host', () => {
    const args = sshArgs('build')
    expect(args.slice(args.indexOf('--'))).toEqual(['--', 'build', 'wraithgrid', 'host-stdio'])
    expect(sshArgs('build', ['x', 'stdio']).slice(-3)).toEqual(['build', 'x', 'stdio'])
    expect(args).toContain('BatchMode=yes')
  })
})

describe('machines in the config', () => {
  const base = {
    version: 1,
    accounts: [],
    workspaces: [{ id: 'ws1', name: 'w', panes: [], layout: null, machineId: 'm-gone' }],
    activeWorkspace: 'ws1',
    machines: [{ id: 'm1', name: 'build', sshHost: 'me@build.local' }]
  }

  it('drops a workspace link to a machine that is gone', () => {
    const r = parseConfig(base)
    expect(r.ok && r.config.workspaces[0]!.machineId).toBeNull()
    expect(r.ok && r.config.machines).toEqual(base.machines)
  })

  it('refuses an ssh host that would read as an option', () => {
    for (const sshHost of ['-oProxyCommand=x', 'a b', 'a;b', '']) {
      expect(parseConfig({ ...base, machines: [{ id: 'm1', name: 'x', sshHost }] }).ok).toBe(false)
    }
  })
})

describe('host-stdio bridge', () => {
  let server: HostServer
  let spawned: SpawnRequest[]

  const killPolicy: KillPolicy = {
    soft: (p) => (p as unknown as FakePty).exit(0),
    hard: () => {},
    sweep: () => {}
  }

  beforeEach(() => {
    spawned = []
    const spawn: SpawnFn = (file, args, opts) => {
      spawned.push({ paneId: '', file, args, cwd: opts.cwd!, env: {}, cols: 0, rows: 0 })
      return new FakePty() as unknown as IPty
    }
    server = new HostServer({
      spawn,
      token: 'remote-token',
      appVersion: '2.0.0',
      pid: 1,
      onIdle: () => {},
      onShutdown: () => {},
      killPolicy,
      flushMs: 1
    })
  })

  /** A GUI-side PaneHost talking through the bridge, as ssh would carry it. */
  function linked(started: { n: number }): PaneHost {
    let up = false
    return new PaneHost({
      connect: async () => {
        const toBridge = new PassThrough()
        const fromBridge = new PassThrough()
        void runBridge({
          input: toBridge,
          output: fromBridge,
          connectHost: async () => {
            if (!up) throw new Error('ENOENT')
            const [a, b] = pipePair()
            server.accept(b)
            return a
          },
          startHost: async () => {
            started.n++
            up = true
          },
          readToken: async () => 'remote-token',
          resolve: async (spec: SpawnSpec) =>
            spec.cwd === '~/missing'
              ? { ok: false, error: 'Folder not found: ~/missing' }
              : {
                  ok: true,
                  req: {
                    paneId: spec.paneId,
                    file: `/remote/bin/${spec.cli}`,
                    args: spec.args,
                    cwd: '/home/remote/proj',
                    env: {},
                    cols: spec.cols,
                    rows: spec.rows
                  }
                },
          sleep: () => tick(1)
        })
        const { Duplex } = await import('node:stream')
        return Duplex.from({ readable: fromBridge, writable: toBridge })
      },
      start: () => Promise.reject(new Error('unreachable')),
      readToken: async () => '', // the bridge puts in the real token
      appVersion: '2.0.0',
      onData: () => {},
      onExit: () => {},
      onMismatch: async () => 'keep'
    })
  }

  const spec = (paneId: string, cwd = '~/proj'): SpawnSpec => ({
    paneId,
    cli: 'claude',
    shell: false,
    configDir: '~/.wraithgrid/accounts/work',
    cwd,
    args: ['--verbose'],
    resume: false,
    cols: 80,
    rows: 24
  })

  it('starts the remote host, signs in for the GUI and resolves panes there', async () => {
    const started = { n: 0 }
    const gui = linked(started)
    const r = await gui.spawn(spec('p1'))
    expect(r.ok).toBe(true)
    expect(started.n).toBe(1)
    expect(spawned[0]).toMatchObject({ file: '/remote/bin/claude', cwd: '/home/remote/proj' })
    expect(await gui.probe()).toEqual({ ok: true, appVersion: '2.0.0', live: 1 })
  })

  it('reports a pane the remote machine cannot start', async () => {
    const gui = linked({ n: 0 })
    expect(await gui.spawn(spec('p1', '~/missing'))).toEqual({
      ok: false,
      error: 'Folder not found: ~/missing'
    })
    // The link still works after a refused pane.
    expect((await gui.spawn(spec('p2'))).ok).toBe(true)
  })
})

describe('pane router', () => {
  it('sends each pane to the host of its workspace machine, and drops a stale link', async () => {
    const calls: string[] = []
    const fake = (name: string): PaneHost =>
      ({
        create: async () => (calls.push(`${name}:create`), { ok: true, pid: 1 }),
        spawn: async () => (calls.push(`${name}:spawn`), { ok: true, pid: 2 }),
        write: (id: string) => calls.push(`${name}:write:${id}`),
        attach: async () => null,
        resize: () => {},
        kill: () => {},
        detach: async () => void calls.push(`${name}:detach`)
      }) as unknown as PaneHost
    let machines: Machine[] = [{ id: 'm1', name: 'build', sshHost: 'build' }]
    const router = new PaneRouter({
      local: fake('local'),
      remote: (m) => fake(`${m.name}@${m.sshHost}`),
      machine: (id) => machines.find((m) => m.id === id),
      machineOf: (paneId) => (paneId.startsWith('r') ? 'm1' : null)
    })
    await router.create({} as SpawnRequest)
    await router.spawnOn('m1', {} as SpawnSpec)
    router.write('l1', 'x')
    router.write('r1', 'y')
    machines = [{ id: 'm1', name: 'build', sshHost: 'build2' }]
    router.write('r1', 'z')
    expect(await router.spawnOn('gone', {} as SpawnSpec)).toMatchObject({ ok: false })
    await router.detachRemotes()
    expect(calls).toEqual([
      'local:create',
      'build@build:spawn',
      'local:write:l1',
      'build@build:write:r1',
      'build@build:detach',
      'build@build2:write:r1',
      'build@build2:detach'
    ])
  })

  it('marks panes of a dropped machine link as disconnected', async () => {
    const exits: PtyExitEvent[] = []
    const [a, b] = pipePair()
    const server = new HostServer({
      spawn: () => new FakePty() as unknown as IPty,
      token: 't',
      appVersion: 'x',
      pid: 1,
      onIdle: () => {},
      onShutdown: () => {}
    })
    server.accept(b)
    const host = new PaneHost({
      connect: async () => a,
      start: async () => {},
      readToken: async () => 't',
      appVersion: 'x',
      onData: () => {},
      onExit: (e) => exits.push(e),
      onMismatch: async () => 'keep',
      lostMessage: 'Disconnected from build.'
    })
    await host.create({ paneId: 'p1', file: 'f', args: [], cwd: '/', env: {}, cols: 80, rows: 24 })
    a.destroy()
    await tick()
    expect(exits).toEqual([
      {
        paneId: 'p1',
        exitCode: -1,
        signal: null,
        error: 'Disconnected from build.',
        disconnected: true
      }
    ])
  })
})

describe('host-stdio bridge backpressure (#141)', () => {
  it('pauses the host socket while ssh output is full, resumes on drain', async () => {
    const [host, far] = pipePair()
    const held: (() => void)[] = []
    const output = new Writable({
      highWaterMark: 64,
      write(_chunk, _enc, cb) {
        held.push(cb)
      }
    })
    void runBridge({
      input: new PassThrough(),
      output,
      connectHost: async () => host,
      startHost: async () => {},
      readToken: async () => 't',
      resolve: async () => ({ ok: false, error: 'unused' })
    })
    await tick(1)
    far.write(`${JSON.stringify({ t: 'data', paneId: 'p', data: 'x'.repeat(200) })}\n`)
    await tick(1)
    expect(host.isPaused()).toBe(true)
    while (held.length) held.shift()!()
    await tick(1)
    expect(host.isPaused()).toBe(false)
  })
})
