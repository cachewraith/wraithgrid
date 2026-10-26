// The smaller bugs of the 2026-10-26 audit (#140), one test each where a unit can show it.
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@shared/chat'
import type { WraithApi } from '@shared/ipc-contract'
import type { PreviewEvent } from '@shared/preview'
import { dayKey, dayKeyBefore } from '@shared/usage'
import { createClaudeAdapter } from '../../src/main/chat/claude'
import type { ChatChild } from '../../src/main/chat/sessions'
import { gitDiff, gitStatus, type GitRunner } from '../../src/main/git'
import { DevServers } from '../../src/main/preview'
import { ChatBus } from '../../src/renderer/lib/chat-bus'
import { EMPTY_THREAD, applyChatEvent, pendingApproval } from '../../src/renderer/lib/chat-thread'
import { parsePatch } from '../../src/renderer/lib/diff'
import { PtyBus } from '../../src/renderer/lib/pty-bus'

const overflow = (stdout: string): Error =>
  Object.assign(new Error('stdout maxBuffer length exceeded'), {
    code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    stdout
  })

describe('git output past the buffer', () => {
  it('a big diff shows what came first, marked cut, not the unstaged-only diff', async () => {
    const run = vi.fn<GitRunner>(async (args) => {
      if (args[0] === 'diff') throw overflow('diff --git a/x b/x\n+one\n')
      return ''
    })
    const r = await gitDiff(run, '/repo')
    expect(r).toMatchObject({ ok: true, truncated: true, patch: 'diff --git a/x b/x\n+one\n' })
    expect(run.mock.calls.filter((c) => c[0][0] === 'diff')).toHaveLength(1)
  })

  it('too many changes to list is still a repo, counted from the whole lines', async () => {
    const run: GitRunner = async () => {
      throw overflow('## main\n M a.ts\n?? b.ts\n?? c')
    }
    expect(await gitStatus(run, '/repo')).toMatchObject({ repo: true, branch: 'main', changed: 2 })
  })
})

describe('diff paths with spaces', () => {
  it('a binary file named with spaces keeps its own name', () => {
    const files = parsePatch(
      'diff --git a/my file.png b/my file.png\nindex 1..2 100644\nBinary files a/my file.png and b/my file.png differ\n'
    )
    expect(files[0]).toMatchObject({ path: 'my file.png', binary: true })
  })
})

describe('preview output line by line', () => {
  it('a URL cut across two chunks is read whole', async () => {
    const ev = new EventEmitter()
    const child = {
      pid: 42,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
      once: (e: string, cb: (...a: unknown[]) => void) => ev.once(e, cb)
    }
    const events: PreviewEvent[] = []
    const ds = new DevServers({
      spawn: () => child as unknown as ChatChild,
      emit: (_id, e) => events.push(e)
    })
    ds.start('p1', { file: 'sh', args: [], cwd: '/', env: {} })
    child.stdout.write('  Local: http://localhost:51')
    await new Promise((r) => setImmediate(r))
    child.stdout.write('73/\nlast line, no newline')
    await new Promise((r) => setImmediate(r))
    ev.emit('exit', 0, null)
    expect(events).toEqual([
      { kind: 'log', line: '  Local: http://localhost:5173/' },
      { kind: 'url', url: 'http://localhost:5173/' },
      { kind: 'log', line: 'last line, no newline' },
      { kind: 'exit', code: 0 }
    ])
  })
})

describe('approvals after Stop', () => {
  it('a question claude takes back closes, and none outlives its turn', () => {
    const a = createClaudeAdapter()
    const ask = a.decode({
      type: 'control_request',
      request_id: 'r1',
      request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } }
    }).events
    const cancel = a.decode({ type: 'control_cancel_request', request_id: 'r1' }).events
    expect(cancel).toEqual([{ t: 'approvalDone', reqId: 'r1', decision: 'deny' }])

    // Without a cancel (codex, an older claude): the turn ending settles it.
    const busy: ChatEvent = { t: 'busy', busy: true }
    let t = [busy, ...ask].reduce((x, e) => applyChatEvent(x, e, 1), EMPTY_THREAD)
    expect(pendingApproval(t)).not.toBeNull()
    t = applyChatEvent(t, { t: 'busy', busy: false }, 2)
    t = applyChatEvent(t, busy, 3)
    expect(pendingApproval(t)).toBeNull()
  })
})

describe('usage days by the calendar', () => {
  const tz = process.env.TZ
  afterEach(() => {
    process.env.TZ = tz
  })

  it('counts back over a clock change without skipping or repeating a day', () => {
    process.env.TZ = 'Europe/Berlin'
    // 2026-03-29 has 23 hours there: 24 h before 00:30 on the 30th is the 28th.
    const now = new Date(2026, 2, 30, 0, 30).getTime()
    expect(dayKey(now - 86_400_000)).toBe('2026-03-28')
    const week = Array.from({ length: 7 }, (_, i) => dayKeyBefore(now, 6 - i))
    expect(week).toEqual([
      '2026-03-24',
      '2026-03-25',
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30'
    ])
    expect(dayKeyBefore(now, 0)).toBe(dayKey(now))
  })
})

describe('chat view load and forget', () => {
  it('a load still reading when the pane was forgotten and reopened adds its items once', async () => {
    type ChatApi = WraithApi['chat']
    const reads: ((raw: string) => void)[] = []
    const bus = new ChatBus({
      onEvent: () => () => {},
      load: () => new Promise<string>((r) => reads.push(r)),
      save: vi.fn()
    } as unknown as ChatApi)
    const saved = JSON.stringify({
      v: 1,
      sessionId: 's',
      model: null,
      seq: 1,
      items: [{ kind: 'notice', id: 'n1', level: 'info', text: 'old' }]
    })
    const first = bus.load('p')
    bus.forget('p')
    const second = bus.load('p')
    reads[0]!(saved)
    reads[1]!(saved)
    await Promise.all([first, second])
    expect(bus.thread('p').items.map((it) => it.id)).toEqual(['n1'])
  })
})

describe('terminal replay', () => {
  it('a reattached screen resets the terminal first, once per replay', () => {
    let onData: (e: { paneId: string; data: string; replay?: boolean }) => void = () => {}
    const pty = {
      onData: (cb: typeof onData) => {
        onData = cb
        return () => {}
      },
      onExit: () => () => {}
    } as unknown as WraithApi['pty']
    const bus = new PtyBus(pty)
    bus.start()
    const out: string[] = []
    bus.attach('p', (d) => out.push(d))
    onData({ paneId: 'p', data: 'old screen' })
    onData({ paneId: 'p', data: 'piece 1', replay: true })
    onData({ paneId: 'p', data: 'piece 2', replay: true })
    onData({ paneId: 'p', data: 'live' })
    expect(out).toEqual(['old screen', '\x1bcpiece 1', 'piece 2', 'live'])
  })
})
