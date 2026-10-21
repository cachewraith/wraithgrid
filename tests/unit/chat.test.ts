import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@shared/chat'
import { chatAdapterFor } from '../../src/main/chat/adapter'
import { createClaudeAdapter, describeClaudeTool } from '../../src/main/chat/claude'
import { ChatSessions, type ChatChild } from '../../src/main/chat/sessions'
import {
  EMPTY_THREAD,
  addUserMessage,
  applyChatEvent,
  chatStatus,
  parseThread,
  pendingApproval,
  serializeThread,
  type ChatThread
} from '../../src/renderer/lib/chat-thread'
import { parseInline, parseMarkdown } from '../../src/renderer/lib/markdown'

// Real claude 2.1.306 output (paths and the plugin list taken out): a Write that asks for
// approval, an interrupted turn, then a second turn in the same process.
const FIXTURE = readFileSync(path.join(__dirname, '../fixtures/claude-chat.ndjson'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as unknown)

const decodeAll = (): ChatEvent[] => {
  const a = createClaudeAdapter()
  return FIXTURE.flatMap((m) => a.decode(m).events)
}

const fold = (events: ChatEvent[], from: ChatThread = EMPTY_THREAD): ChatThread =>
  events.reduce((t, e) => applyChatEvent(t, e, 1000), from)

describe('claude chat adapter', () => {
  it('runs claude headless with stream-json both ways and approvals over stdio', () => {
    const a = createClaudeAdapter()
    const args = a.args({ sessionId: null, continueLast: false, model: null, effort: null })
    expect(args.slice(0, 1)).toEqual(['-p'])
    expect(args.join(' ')).toContain('--input-format stream-json --output-format stream-json')
    expect(args.join(' ')).toContain('--permission-prompt-tool stdio')
    expect(
      a.args({ sessionId: 'abc-1', continueLast: true, model: null, effort: null }).slice(-2)
    ).toEqual(['--resume', 'abc-1'])
    expect(a.args({ sessionId: null, continueLast: true, model: null, effort: null }).at(-1)).toBe(
      '--continue'
    )
    expect(a.hello()).toEqual([
      expect.objectContaining({ type: 'control_request', request: { subtype: 'initialize' } })
    ])
  })

  it('reads the models and plan from the initialize answer, and switches model live', () => {
    const a = createClaudeAdapter()
    const [hello] = a.hello() as { request_id: string }[]
    // The shape of real claude 2.1.306 output, trimmed.
    const out = a.decode({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: hello!.request_id,
        response: {
          models: [
            {
              value: 'sonnet',
              displayName: 'Sonnet 5.5',
              description: 'Most efficient for simpler tasks',
              supportsEffort: true,
              supportedEffortLevels: ['low', 'high']
            },
            { value: 'x', displayName: 'X', supportsEffort: false },
            { displayName: 'no value' }
          ],
          account: { email: 'me@example.com', subscriptionType: 'Claude Pro' }
        }
      }
    })
    expect(out.events).toEqual([
      {
        t: 'capabilities',
        models: [
          {
            value: 'sonnet',
            label: 'Sonnet 5.5',
            description: 'Most efficient for simpler tasks',
            efforts: ['low', 'high']
          },
          { value: 'x', label: 'X', description: '', efforts: [] }
        ],
        account: { email: 'me@example.com', plan: 'Claude Pro' }
      }
    ])
    // Another request's answer is not the model list.
    expect(
      a.decode({ type: 'control_response', response: { subtype: 'success', request_id: 'other' } })
        .events
    ).toEqual([])
    expect(a.setModel('haiku')).toMatchObject({
      type: 'control_request',
      request: { subtype: 'set_model', model: 'haiku' }
    })
    expect(
      a.args({ sessionId: 's', continueLast: false, model: 'opus', effort: 'max' }).slice(-6)
    ).toEqual(['--resume', 's', '--model', 'opus', '--effort', 'max'])
  })

  it('only claude has a chat adapter for now', () => {
    expect(chatAdapterFor('claude')).not.toBeNull()
    expect(chatAdapterFor('codex')).toBeNull()
  })

  it('decodes a real session: session id, tool, approval, result, streamed text', () => {
    const events = decodeAll()
    expect(events[0]).toEqual({
      t: 'session',
      id: 'dd6d7ff1-33ba-479a-93f6-7d4d4c475db9',
      model: 'claude-haiku-5-5'
    })
    const tool = events.find((e) => e.t === 'tool')
    expect(tool).toMatchObject({
      t: 'tool',
      id: 'toolu_01QXxLZjFxVanbdFjNHLRbFZ',
      name: 'Write',
      kind: 'edit',
      subtitle: '/work/hello.txt',
      preview: { type: 'diff', before: '', after: 'hi\n' }
    })
    expect(events.find((e) => e.t === 'approval')).toMatchObject({
      toolId: 'toolu_01QXxLZjFxVanbdFjNHLRbFZ',
      name: 'Write',
      canAlways: true
    })
    expect(events.find((e) => e.t === 'toolResult')).toMatchObject({ isError: false })
    const text = events
      .filter((e): e is Extract<ChatEvent, { t: 'text' }> => e.t === 'text')
      .map((e) => e.delta)
      .join('')
    // Streamed once as deltas, not again from the full message.
    expect(text.match(/Created `hello\.txt`/g)).toHaveLength(1)
    expect(text).toContain('ok')
  })

  it('a stopped turn is a notice, not an error', () => {
    const turns = decodeAll().filter((e) => e.t === 'turnEnd')
    expect(turns).toHaveLength(3)
    expect(turns.map((t) => (t as { error: string | null }).error)).toEqual([null, null, null])
    expect(decodeAll()).toContainEqual({ t: 'notice', level: 'info', text: 'Interrupted' })
  })

  it('answers approvals with the input claude asked about, never the renderer', () => {
    const a = createClaudeAdapter()
    const req = FIXTURE.find((m) => (m as { type: string }).type === 'control_request')!
    a.decode(req)
    const id = (req as { request_id: string }).request_id
    expect(a.answer('nope', 'allow')).toBeNull()
    expect(a.answer(id, 'always')).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: id,
        response: {
          behavior: 'allow',
          updatedInput: { file_path: '/work/hello.txt', content: 'hi\n' },
          updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]
        }
      }
    })
    // Answered once only.
    expect(a.answer(id, 'deny')).toBeNull()
  })

  it('refuses control requests meant for an SDK host so claude does not wait', () => {
    const out = createClaudeAdapter().decode({
      type: 'control_request',
      request_id: 'r1',
      request: { subtype: 'hook_callback' }
    })
    expect(out.events).toEqual([])
    expect(out.replies).toEqual([
      {
        type: 'control_response',
        response: { subtype: 'error', request_id: 'r1', error: 'Not supported by Wraithgrid' }
      }
    ])
  })

  it('skips a subagent’s own steps', () => {
    const out = createClaudeAdapter().decode({
      type: 'assistant',
      parent_tool_use_id: 'toolu_x',
      message: { id: 'm', content: [{ type: 'text', text: 'inner' }] }
    })
    expect(out.events).toEqual([])
  })

  it('describes tools by kind', () => {
    expect(describeClaudeTool('Bash', { command: 'ls -la\necho', description: 'List' })).toEqual({
      kind: 'shell',
      subtitle: 'List',
      preview: { type: 'code', text: 'ls -la\necho' }
    })
    expect(describeClaudeTool('Grep', { pattern: 'foo', path: 'src' }).subtitle).toBe(
      'foo  in  src'
    )
    expect(
      describeClaudeTool('TodoWrite', {
        todos: [
          { content: 'a', status: 'completed' },
          { content: 'b', status: 'in_progress' }
        ]
      })
    ).toMatchObject({ kind: 'todo', subtitle: '1/2 done' })
    expect(describeClaudeTool('mcp__x__y', { q: 'hello' })).toMatchObject({
      kind: 'other',
      subtitle: 'hello'
    })
  })

  it('sends pasted images as base64 blocks before the text', () => {
    expect(createClaudeAdapter().user('look', [{ mediaType: 'image/png', data: 'AAAA' }])).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: 'look' }
        ]
      }
    })
  })
})

describe('chat thread', () => {
  it('folds the real session into messages, a tool card and turn footers', () => {
    let t = addUserMessage(EMPTY_THREAD, 'make hello.txt', 0, 1000)
    expect(chatStatus(t)).toBe('running')
    t = fold(decodeAll(), t)
    expect(t.sessionId).toBe('66c48029-202a-4285-83f3-e703fccd20e8')
    expect(t.busy).toBe(false)
    const kinds = t.items.map((i) => i.kind)
    expect(kinds[0]).toBe('user')
    expect(kinds).toContain('tool')
    expect(kinds.filter((k) => k === 'turn')).toHaveLength(3)
    const tool = t.items.find((i) => i.kind === 'tool')!
    expect(tool).toMatchObject({ output: expect.stringContaining('File created'), isError: false })
  })

  it('a pending approval makes the status "approval" until answered', () => {
    let t = applyChatEvent(EMPTY_THREAD, { t: 'busy', busy: true }, 0)
    t = fold(
      [
        { t: 'tool', id: 'x', name: 'Bash', kind: 'shell', subtitle: 'ls', preview: null },
        {
          t: 'approval',
          reqId: 'r',
          toolId: 'x',
          name: 'Bash',
          subtitle: 'ls',
          preview: null,
          canAlways: false
        }
      ],
      t
    )
    expect(t.items).toHaveLength(1)
    expect(pendingApproval(t)?.id).toBe('x')
    expect(chatStatus(t)).toBe('approval')
    t = applyChatEvent(t, { t: 'approvalDone', reqId: 'r', decision: 'allow' }, 0)
    expect(chatStatus(t)).toBe('running')
  })

  it('a crash shows its error and ends the turn', () => {
    const t = fold([
      { t: 'busy', busy: true },
      { t: 'exit', code: 1, signal: null, error: 'Not logged in' }
    ])
    expect(t.busy).toBe(false)
    expect(t.items.at(-1)).toMatchObject({ kind: 'notice', level: 'error', text: 'Not logged in' })
  })

  it('round-trips through the saved view; unanswered approvals come back settled', () => {
    const t = fold([
      { t: 'session', id: 's1', model: 'm' },
      { t: 'tool', id: 'x', name: 'Bash', kind: 'shell', subtitle: 'ls', preview: null },
      {
        t: 'approval',
        reqId: 'r',
        toolId: 'x',
        name: 'Bash',
        subtitle: 'ls',
        preview: null,
        canAlways: false
      }
    ])
    const back = parseThread(serializeThread(t))
    expect(back.sessionId).toBe('s1')
    expect(back.restored).toBe(1)
    expect(pendingApproval(back)).toBeNull()
    expect(parseThread('{"v":99}')).toBe(EMPTY_THREAD)
    expect(parseThread('not json')).toBe(EMPTY_THREAD)
    expect(parseThread(null)).toBe(EMPTY_THREAD)
  })
})

class FakeChild extends EventEmitter {
  pid = 4242
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  written: unknown[] = []
  signals: string[] = []
  constructor() {
    super()
    this.stdin.on('data', (d: Buffer) =>
      d
        .toString()
        .split('\n')
        .filter(Boolean)
        .forEach((l) => this.written.push(JSON.parse(l)))
    )
  }
  kill(signal = 'SIGTERM'): boolean {
    this.signals.push(signal)
    setImmediate(() => this.emit('exit', null, signal))
    return true
  }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('chat sessions', () => {
  const setup = () => {
    const child = new FakeChild()
    const events: ChatEvent[] = []
    const sessions = new ChatSessions({
      spawn: () => child as unknown as ChatChild,
      emit: (_id, e) => events.push(e),
      stopGraceMs: 50
    })
    sessions.start('p1', { file: 'claude', args: [], cwd: '/', env: {} }, createClaudeAdapter())
    return { child, events, sessions }
  }

  it('says hello, sends messages, decodes split lines and answers approvals', async () => {
    const { child, events, sessions } = setup()
    expect(sessions.send('p1', 'hi', [])).toBe(true)
    // One line in two chunks, then a line of noise.
    const req = JSON.stringify(
      FIXTURE.find((m) => (m as { type: string }).type === 'control_request')
    )
    child.stdout.write(req.slice(0, 40))
    child.stdout.write(`${req.slice(40)}\nnot json\n`)
    await tick()
    const approval = events.find((e) => e.t === 'approval') as { reqId: string }
    expect(approval).toBeTruthy()
    expect(sessions.approve('p1', approval.reqId, 'deny')).toBe(true)
    await tick()
    expect(child.written.map((m) => (m as { type: string }).type)).toEqual([
      'control_request',
      'user',
      'control_response'
    ])
    expect(events).toContainEqual({ t: 'busy', busy: true })
    expect(events).toContainEqual({ t: 'approvalDone', reqId: approval.reqId, decision: 'deny' })
  })

  it('reports a crash with its last stderr line', async () => {
    const { child, events, sessions } = setup()
    child.stderr.write('warming up\nError: Invalid API key\n')
    await tick()
    child.emit('exit', 1, null)
    expect(sessions.has('p1')).toBe(false)
    expect(events.at(-1)).toEqual({
      t: 'exit',
      code: 1,
      signal: null,
      error: 'Error: Invalid API key'
    })
  })

  it('a requested stop is quiet: no exit event for a process the window replaced', async () => {
    const { child, events, sessions } = setup()
    await sessions.stop('p1')
    expect(child.signals).toEqual(['SIGTERM'])
    expect(events.some((e) => e.t === 'exit')).toBe(false)
    expect(sessions.count).toBe(0)
  })

  it('interrupt goes over the pipe, not a signal', async () => {
    const { child, sessions } = setup()
    sessions.interrupt('p1')
    await tick()
    expect(child.signals).toEqual([])
    expect(child.written.at(-1)).toMatchObject({ request: { subtype: 'interrupt' } })
  })
})

describe('markdown', () => {
  it('parses the blocks agents write', () => {
    const md = [
      '## Plan',
      '',
      'Some **bold** and `code` text.',
      '',
      '- [x] done item',
      '- [ ] open item',
      '  - nested',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '',
      '| a | b |',
      '|---|--:|',
      '| 1 | 2 |',
      '',
      '---',
      '```ts',
      'const x = 1',
      '```'
    ].join('\n')
    const types = parseMarkdown(md).map((b) => b.type)
    expect(types).toEqual(['heading', 'para', 'list', 'list', 'quote', 'table', 'hr', 'code'])
    const tasks = parseMarkdown(md)[2] as Extract<
      ReturnType<typeof parseMarkdown>[number],
      { type: 'list' }
    >
    expect(tasks.items.map((i) => [i.task, i.depth])).toEqual([
      [true, 0],
      [false, 0],
      [null, 1]
    ])
    const table = parseMarkdown(md)[5] as { align: unknown[] }
    expect(table.align).toEqual([null, 'right'])
  })

  it('an unclosed fence while streaming is an open code block', () => {
    expect(parseMarkdown('```py\nprint(1)')).toEqual([
      { type: 'code', lang: 'py', text: 'print(1)', open: true }
    ])
  })

  it('links only to http(s) and mailto', () => {
    expect(parseInline('[x](https://a.dev) [y](javascript:alert(1))')).toEqual([
      { t: 'a', href: 'https://a.dev', c: [{ t: 'text', v: 'x' }] },
      { t: 'text', v: ' [y](javascript:alert(1))' }
    ])
    expect(parseInline('see https://x.io/a.')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'a', href: 'https://x.io/a', c: [{ t: 'text', v: 'https://x.io/a' }] },
      { t: 'text', v: '.' }
    ])
  })

  it('keeps snake_case words and lone stars as text', () => {
    expect(parseInline('a_b_c and 2 * 3 * 4')).toEqual([{ t: 'text', v: 'a_b_c and 2 * 3 * 4' }])
    expect(parseInline('*em* __b__ ~~s~~')).toEqual([
      { t: 'i', c: [{ t: 'text', v: 'em' }] },
      { t: 'text', v: ' ' },
      { t: 'b', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 's', c: [{ t: 'text', v: 's' }] }
    ])
  })
})
