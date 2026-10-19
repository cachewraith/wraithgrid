import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { IPty } from 'node-pty'
import { AGENT_CLI_SPECS } from '@shared/agent-clis'
import { parseConfig } from '@shared/schema'
import type { Config } from '@shared/types'
import type { KillPolicy, SpawnFn } from '../../src/host/pty-manager'
import { HostServer } from '../../src/host/server'
import { CLI_HELP, DETACH_KEY, isCliCommand, runCli, type Tty } from '../../src/main/cli'
import { HostConnection, PaneHost } from '../../src/main/pane-host'
import { FakePty, pipePair, tick } from './host-fixtures'

const parsed = parseConfig({
  version: 1,
  claudePath: '',
  accounts: [
    { id: 'a-work', name: 'work', configDir: '~/.wraithgrid/accounts/work', color: '#7c5cff' },
    {
      id: 'a-gem',
      name: 'gem',
      configDir: '~/.wraithgrid/accounts/gem',
      color: '#7c5cff',
      cli: 'gemini'
    }
  ],
  workspaces: [
    {
      id: 'ws-main',
      name: 'main',
      panes: [
        { id: 'p1', accountId: 'a-work', cwd: '~/alpha', args: [], shell: false, title: 'alpha' },
        { id: 'p2', accountId: 'a-gem', cwd: '~/beta', args: [], shell: false, title: 'beta' },
        { id: 'p3', accountId: null, cwd: '~', args: [], shell: true, title: 'shell' }
      ],
      layout: null
    }
  ],
  activeWorkspace: 'ws-main',
  recentFolders: [],
  settings: {}
})
if (!parsed.ok) throw new Error(parsed.error)
const config: Config = parsed.config

const req = (paneId: string, approval?: RegExp) => ({
  paneId,
  file: '/bin/claude',
  args: [],
  cwd: '/tmp',
  env: {},
  cols: 80,
  rows: 24,
  approval: approval?.source
})

describe('wraithgrid command', () => {
  let ptys: Map<string, FakePty>
  let server: HostServer
  let gui: PaneHost
  let clock: number
  let actions: Record<string, unknown>[]
  let out: string[]
  let errs: string[]

  const killPolicy: KillPolicy = {
    soft: (p) => (p as unknown as FakePty).exit(0),
    hard: () => {},
    sweep: () => {}
  }

  const connectTo = (s: HostServer) => async () => {
    const [a, b] = pipePair()
    s.accept(b)
    return a
  }

  const run = (argv: string[], hasHost = true, tty?: Tty): Promise<number> =>
    runCli(argv, {
      tty,
      connect: hasHost
        ? connectTo(server)
        : () => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      readToken: async () => 'secret',
      readConfig: async () => config,
      appVersion: 'test',
      cwd: '/work/here',
      out: (t) => out.push(t),
      err: (t) => errs.push(t),
      sleep: () => tick(1)
    })

  beforeEach(async () => {
    ptys = new Map()
    clock = 100_000
    actions = []
    out = []
    errs = []
    let lastId = ''
    const spawn: SpawnFn = () => {
      const p = new FakePty()
      ptys.set(lastId, p)
      return p as unknown as IPty
    }
    server = new HostServer({
      spawn,
      token: 'secret',
      appVersion: 'test',
      pid: 1,
      onIdle: () => {},
      onShutdown: () => {},
      killPolicy,
      flushMs: 1,
      waitTickMs: 5,
      now: () => clock
    })
    gui = new PaneHost({
      connect: connectTo(server),
      start: async () => {},
      readToken: async () => 'secret',
      appVersion: 'test',
      onData: () => {},
      onExit: () => {},
      onMismatch: async () => 'keep',
      onGuiAction: async (action) => {
        actions.push(action)
        lastId = 'p-new'
        await gui.create(req('p-new'))
        return { ok: true, paneId: 'p-new' }
      }
    })
    gui.setCliAccess(true)
    for (const id of ['p1', 'p2']) {
      lastId = id
      await gui.create(req(id, id === 'p1' ? AGENT_CLI_SPECS.claude.approval : undefined))
    }
  })

  it('is refused while command-line access is off', async () => {
    gui.setCliAccess(false)
    await tick()
    expect(await run(['list'])).toBe(1)
    expect(errs.join()).toMatch(/Command-line access is off/)
  })

  it('says so when no host runs', async () => {
    expect(await run(['list'], false)).toBe(1)
    expect(errs.join()).toMatch(/not running any agents/)
  })

  it('prints help and rejects wrong usage', async () => {
    expect(await run(['help'])).toBe(0)
    expect(out).toEqual([CLI_HELP])
    expect(await run(['wait'])).toBe(2)
    expect(await run(['wait', 'alpha', '--until', 'sleepy'])).toBe(2)
    expect(isCliCommand('list')).toBe(true)
    expect(isCliCommand('--no-sandbox')).toBe(false)
    expect(isCliCommand(undefined)).toBe(false)
  })

  it('lists panes with titles, accounts and state', async () => {
    expect(await run(['list'])).toBe(0)
    const lines = out[0]!.split('\n')
    expect(lines[0]).toMatch(/^ID\s+TITLE\s+WORKSPACE\s+ACCOUNT\s+CLI\s+STATE\s+PID$/)
    expect(lines[1]).toMatch(/^p1\s+alpha\s+main\s+work\s+claude\s+idle\s+\d+$/)
    expect(lines[2]).toMatch(/^p2\s+beta\s+main\s+gem\s+gemini\s+idle/)
    expect(lines[3]).toMatch(/^p3\s+shell\s+main\s+shell\s+stopped$/)
    out = []
    expect(await run(['list', '--json'])).toBe(0)
    expect(JSON.parse(out[0]!)[0]).toMatchObject({ id: 'p1', title: 'alpha', state: 'idle' })
  })

  it('reads a pane by title', async () => {
    ptys.get('p1')!.emit('hello\r\nworld')
    await tick()
    expect(await run(['read', 'ALPHA'])).toBe(0)
    expect(out[0]).toBe('hello\nworld')
  })

  it('types text, then Enter; a line break is the CLI new-line key', async () => {
    expect(await run(['send', 'alpha', 'fix', 'the', 'bug'])).toBe(0)
    expect(ptys.get('p1')!.written).toEqual(['fix the bug', '\r'])
    expect(await run(['send', 'p1', 'one\ntwo', '--no-enter'])).toBe(0)
    expect(ptys.get('p1')!.written.slice(2)).toEqual(['one\x1b\rtwo'])
    // gemini has no new-line key: the text goes as typed.
    expect(await run(['send', 'beta', 'a\nb', '--no-enter'])).toBe(0)
    expect(ptys.get('p2')!.written).toEqual(['a\nb'])
    expect(await run(['send', 'shell', 'ls'])).toBe(1)
    expect(errs.join()).toMatch(/not running/)
  })

  /** The pane's state as the host reports it (CI timers are coarse: never assume timing). */
  const stateOf = async (paneId: string): Promise<string> => {
    const before = out.length
    await run(['list', '--json'])
    const rows = JSON.parse(out.splice(before).join('')) as { id: string; state: string }[]
    return rows.find((r) => r.id === paneId)?.state ?? ''
  }
  const until = async (check: () => Promise<boolean>): Promise<void> => {
    for (let i = 0; i < 200 && !(await check()); i++) await tick(5)
  }
  /** Until the host holds `n` pending waits: only then may the test move the clock. */
  const waiting = (n = 1): Promise<void> =>
    until(async () => (server as unknown as { waiters: Set<unknown> }).waiters.size >= n)

  it('waits for idle after the pane worked, quiet for --quiet', async () => {
    clock += 1000
    ptys.get('p1')!.emit('working…')
    await until(async () => (await stateOf('p1')) === 'running')
    let settled = false
    const done = run(['wait', 'alpha', '--quiet', '100', '--timeout', '30']).then((code) => {
      settled = true
      return code
    })
    await waiting()
    await tick(50)
    expect(settled).toBe(false) // still running
    clock += 1500 // past the running window: idle starts, at this (frozen) time
    await tick(50)
    expect(settled).toBe(false) // idle, but not quiet for 100 ms yet
    clock += 200
    expect(await done).toBe(0)
    expect(out).toEqual(['idle'])
  })

  it('a prompt just sent counts as running until the CLI answers', async () => {
    expect(await run(['send', 'alpha', 'go'])).toBe(0)
    const done = run(['wait', 'alpha', '--quiet', '0', '--timeout', '30'])
    await waiting()
    await tick(30)
    expect(out).toEqual([])
    clock += 11_000 // no answer for 10 s: idle after all
    expect(await done).toBe(0)
  })

  it('waits for an approval prompt, times out, and sees an exit', async () => {
    const blocked = run(['wait', 'alpha', '--until', 'blocked', '--timeout', '30'])
    ptys.get('p1')!.emit('Bash command\r\n  rm -rf build\r\nDo you want to proceed?\r\n')
    expect(await blocked).toBe(0)
    expect(out).toEqual(['blocked'])

    const late = run(['wait', 'beta', '--until', 'blocked', '--timeout', '5'])
    await waiting()
    clock += 6000
    expect(await late).toBe(1)
    expect(errs.join()).toMatch(/Timed out; the pane is idle/)

    const exited = run(['wait', 'beta', '--until', 'exited'])
    await waiting()
    ptys.get('p2')!.exit(0)
    expect(await exited).toBe(0)
  })

  it('opens panes through the window and returns once they run', async () => {
    expect(await run(['new', '--account', 'work', '--cwd', 'sub', '--', '--model', 'opus'])).toBe(0)
    expect(actions[0]).toEqual({
      kind: 'new',
      account: 'work',
      // path.resolve gives D:\… on Windows CI.
      cwd: path.resolve('/work/here', 'sub'),
      args: ['--model', 'opus']
    })
    expect(out).toEqual(['p-new'])
    expect(await run(['split', 'beta', '--shell'])).toBe(0)
    expect(actions[1]).toEqual({ kind: 'split', paneId: 'p2', shell: true })
  })

  it('may not create, attach or kill panes itself', async () => {
    const [a, b] = pipePair()
    server.accept(b)
    const { conn } = await HostConnection.open(a, 'secret', 'test', 'cli')
    const r = await conn.request({ t: 'create', req: req('evil') })
    expect(r).toEqual({ ok: false, error: 'Only the Wraithgrid window may do that.' })
    conn.close()
  })

  it('attach mirrors a pane in the terminal until Ctrl+], then gives the window its size back', async () => {
    ptys.get('p1')!.emit('before attach')
    await tick()
    const written: string[] = []
    let input: (d: string) => void = () => {}
    let resized: () => void = () => {}
    let size = { cols: 120, rows: 40 }
    const rawModes: boolean[] = []
    const tty: Tty = {
      size: () => size,
      write: (d) => written.push(d),
      raw: (on) => rawModes.push(on),
      onInput: (cb) => ((input = cb), () => (input = () => {})),
      onResize: (cb) => ((resized = cb), () => (resized = () => {}))
    }
    const done = run(['attach', 'alpha'], true, tty)
    await tick(30)
    expect(written[0]!.startsWith('\x1b[H\x1b[2J')).toBe(true)
    expect(written[0]).toContain('before attach')
    expect(ptys.get('p1')!.size).toEqual({ cols: 120, rows: 40 })

    ptys.get('p1')!.emit('live')
    input('ls\r')
    size = { cols: 100, rows: 30 }
    resized()
    await tick()
    expect(written).toContain('live')
    expect(ptys.get('p1')!.written).toEqual(['ls\r'])
    expect(ptys.get('p1')!.size).toEqual({ cols: 100, rows: 30 })

    input(`x${DETACH_KEY}`)
    expect(await done).toBe(0)
    expect(rawModes).toEqual([true, false])
    expect(written.at(-1)).toContain('detached from p1; it keeps running')
    expect(ptys.get('p1')!.written).toEqual(['ls\r', 'x'])
    await tick()
    expect(ptys.get('p1')!.size).toEqual({ cols: 80, rows: 24 }) // the window's size again
    expect(server.liveCount).toBe(2)
  })

  it('attach needs a terminal and ends when the pane exits', async () => {
    expect(await run(['attach', 'alpha'])).toBe(1)
    expect(errs.join()).toMatch(/needs a terminal/)
    const written: string[] = []
    const tty: Tty = {
      size: () => ({ cols: 80, rows: 24 }),
      write: (d) => written.push(d),
      raw: () => {},
      onInput: () => () => {},
      onResize: () => () => {}
    }
    const done = run(['attach', 'beta'], true, tty)
    await tick(30)
    ptys.get('p2')!.exit(5)
    expect(await done).toBe(0)
    expect(written.at(-1)).toContain('pane exited with code 5')
  })

  it('stop ends every agent', async () => {
    expect(await run(['stop'])).toBe(0)
    expect(out).toEqual(['Stopped 2 agents.'])
    expect(server.liveCount).toBe(0)
  })
})
