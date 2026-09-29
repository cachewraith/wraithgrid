import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IPty } from 'node-pty'
import type { PtyExitEvent } from '@shared/ipc-contract'
import { PtyManager, type KillPolicy, type SpawnFn } from '../../src/main/pty-manager'

type Listener<T> = (e: T) => void

class FakePty {
  static nextPid = 1000
  pid = FakePty.nextPid++
  written: string[] = []
  size = { cols: 0, rows: 0 }
  private dataL: Listener<string>[] = []
  private exitL: Listener<{ exitCode: number; signal?: number }>[] = []
  onData = (l: Listener<string>) => {
    this.dataL.push(l)
    return { dispose: () => (this.dataL = this.dataL.filter((x) => x !== l)) }
  }
  onExit = (l: Listener<{ exitCode: number; signal?: number }>) => {
    this.exitL.push(l)
    return { dispose: () => (this.exitL = this.exitL.filter((x) => x !== l)) }
  }
  write = (d: string) => this.written.push(d)
  resize = (cols: number, rows: number) => (this.size = { cols, rows })
  emit(d: string) {
    this.dataL.forEach((l) => l(d))
  }
  exit(code: number, signal?: number) {
    this.exitL.forEach((l) => l({ exitCode: code, signal }))
  }
}

const req = (paneId: string) => ({
  paneId,
  file: '/bin/claude',
  args: [],
  cwd: '/tmp',
  env: {},
  cols: 80,
  rows: 24
})

describe('PtyManager', () => {
  let ptys: FakePty[]
  let data: [string, string][]
  let exits: PtyExitEvent[]
  let kills: [string, number][]
  let mgr: PtyManager

  beforeEach(() => {
    vi.useFakeTimers()
    ptys = []
    data = []
    exits = []
    kills = []
    const spawn: SpawnFn = () => {
      const p = new FakePty()
      ptys.push(p)
      return p as unknown as IPty
    }
    const killPolicy: KillPolicy = {
      soft: (pty) => kills.push(['soft', pty.pid]),
      hard: (pid) => kills.push(['hard', pid]),
      sweep: (pid) => kills.push(['sweep', pid])
    }
    mgr = new PtyManager({
      spawn,
      killPolicy,
      onData: (id, d) => data.push([id, d]),
      onExit: (e) => exits.push(e)
    })
  })
  afterEach(() => vi.useRealTimers())

  it('coalesces output per pane into one message per 16 ms', () => {
    mgr.create(req('a'))
    mgr.create(req('b'))
    ptys[0]!.emit('he')
    ptys[0]!.emit('llo')
    ptys[1]!.emit('x')
    expect(data).toEqual([])
    vi.advanceTimersByTime(16)
    expect(data).toEqual([
      ['a', 'hello'],
      ['b', 'x']
    ])
  })

  it('flushes pending output before reporting exit', () => {
    mgr.create(req('a'))
    ptys[0]!.emit('bye')
    ptys[0]!.exit(1)
    expect(data).toEqual([['a', 'bye']])
    expect(exits).toEqual([{ paneId: 'a', exitCode: 1, signal: null }])
    expect(mgr.has('a')).toBe(false)
  })

  it('routes write and resize to the right pane', () => {
    mgr.create(req('a'))
    mgr.create(req('b'))
    mgr.write('b', 'ls\r')
    mgr.resize('a', 120, 40)
    expect(ptys[1]!.written).toEqual(['ls\r'])
    expect(ptys[0]!.size).toEqual({ cols: 120, rows: 40 })
    // Unknown panes are ignored rather than throwing.
    expect(() => mgr.write('zzz', 'x')).not.toThrow()
  })

  it('reports a spawn failure instead of throwing', () => {
    const failing = new PtyManager({
      spawn: () => {
        throw new Error('ENOENT: no such file')
      },
      onData: () => {},
      onExit: () => {}
    })
    expect(failing.create(req('a'))).toEqual({ ok: false, error: 'ENOENT: no such file' })
  })

  it('kill stops softly, then hard after the grace period, without an exit event', async () => {
    mgr.create(req('a'))
    const pid = ptys[0]!.pid
    const done = mgr.kill('a')
    expect(kills).toEqual([['soft', pid]])
    vi.advanceTimersByTime(2000)
    await done
    expect(kills).toEqual([
      ['soft', pid],
      ['hard', pid]
    ])
    expect(exits).toEqual([])
  })

  it('kill resolves early when the process exits, and sweeps its group', async () => {
    mgr.create(req('a'))
    const pid = ptys[0]!.pid
    const done = mgr.kill('a')
    ptys[0]!.exit(0, 1)
    await done
    expect(kills).toEqual([
      ['soft', pid],
      ['sweep', pid]
    ])
    expect(exits).toEqual([])
  })

  it('killAll stops every pane', async () => {
    mgr.create(req('a'))
    mgr.create(req('b'))
    const done = mgr.killAll()
    ptys.forEach((p) => p.exit(0))
    await done
    expect(mgr.size).toBe(0)
    expect(kills.filter(([k]) => k === 'soft').map(([, pid]) => pid)).toEqual(
      ptys.map((p) => p.pid)
    )
  })

  it('a restart replaces the old process and ignores its late exit', () => {
    mgr.create(req('a'))
    mgr.create(req('a'))
    expect(ptys).toHaveLength(2)
    ptys[0]!.exit(0)
    expect(exits).toEqual([])
    expect(mgr.has('a')).toBe(true)
    ptys[1]!.emit('new')
    vi.advanceTimersByTime(16)
    expect(data).toEqual([['a', 'new']])
  })
})
