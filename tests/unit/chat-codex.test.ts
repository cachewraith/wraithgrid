import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@shared/chat'
import { AGENT_CLI_SPECS } from '@shared/agent-clis'
import { chatAdapterFor } from '../../src/main/chat/adapter'
import {
  createCodexAdapter,
  describeCodexItem,
  parseCodexModels,
  parseCodexSkills
} from '../../src/main/chat/codex'
import { EMPTY_THREAD, addUserMessage, applyChatEvent } from '../../src/renderer/lib/chat-thread'

// Real `codex app-server` output (codex-cli 0.163.0; account details replaced): a turn with two
// commands that asked for approval, a turn interrupted mid-answer, then a short turn.
const FIXTURE = readFileSync(path.join(__dirname, '../fixtures/codex-chat.ndjson'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Record<string, unknown>)

type Line = Record<string, unknown>
const base = { sessionId: null, continueLast: false, model: null, effort: null }

/** Replays the recording, sending what the recorder sent at the same points. */
function replay() {
  const a = createCodexAdapter()
  a.args({ ...base, effort: 'low' })
  const sent: Line[] = [...(a.hello() as Line[])]
  const events: ChatEvent[] = []
  let turns = 0
  let interrupted = false
  for (const msg of FIXTURE) {
    const out = a.decode(msg)
    sent.push(...(out.replies as Line[]))
    for (const e of out.events) {
      events.push(e)
      if (e.t === 'session') sent.push(a.user('do it', []) as Line)
      if (e.t === 'approval') sent.push(a.answer(e.reqId, 'allow') as Line)
      if (e.t === 'turnEnd' && ++turns < 3) sent.push(a.user('next', []) as Line)
      if (e.t === 'text' && turns === 1 && !interrupted) {
        interrupted = true
        sent.push(a.interrupt() as Line)
      }
    }
  }
  return { sent, events }
}

describe('codex chat adapter (#40)', () => {
  it('counts each turn as the change in the thread total, never a cost (#53)', () => {
    const ends = replay().events.filter((e) => e.t === 'turnEnd')
    expect(ends).toHaveLength(3)
    const used = ends.map((e) => (e.t === 'turnEnd' ? e.usage : null))
    // Real codex-cli 0.163.0 counts: turn 1 made two model calls; turn 2 none (repeats the
    // total); turn 3 one. `input` here excludes the cached part, which is cacheRead.
    expect(used[0]).toEqual({
      model: null,
      costUsd: null,
      input: 28771 - 26368,
      output: 78,
      cacheRead: 26368,
      cacheWrite: 0
    })
    expect(used[1]).toMatchObject({ input: 0, output: 0, cacheRead: 0 })
    const sum = used.reduce((n, u) => n + (u ? u.input + u.output + u.cacheRead : 0), 0)
    expect(sum).toBe(44916)
  })

  it('a resumed thread counts from its first report, not its whole history (#53)', () => {
    const a = createCodexAdapter()
    const tok = (n: number) => ({ inputTokens: n, cachedInputTokens: 0, outputTokens: 1 })
    a.decode({
      method: 'thread/tokenUsage/updated',
      params: { tokenUsage: { total: tok(90_000), last: tok(500) } }
    })
    const end = a
      .decode({ method: 'turn/completed', params: { turn: { id: 't', status: 'completed' } } })
      .events.find((e) => e.t === 'turnEnd')
    expect(end).toMatchObject({ usage: { input: 500, output: 1 } })
  })

  it('is registered and runs the app server', () => {
    expect(chatAdapterFor('codex')).not.toBeNull()
    expect(AGENT_CLI_SPECS.codex.chat).toBe(true)
    expect(createCodexAdapter().args(base)).toEqual(['app-server'])
  })

  it('speaks JSON-RPC like the recording: hello, thread, turns, approvals, interrupt', () => {
    const { sent } = replay()
    expect(sent.map((m) => m.method ?? `answer ${String(m.id)}`)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'model/list',
      'account/read',
      'account/rateLimits/read',
      'skills/list',
      'turn/start',
      'answer 0',
      'answer 1',
      'turn/start',
      'turn/interrupt',
      'turn/start'
    ])
    expect(sent[2]!.params).toMatchObject({
      approvalPolicy: 'untrusted',
      sandbox: 'workspace-write'
    })
    expect(sent[7]!.params).toMatchObject({
      threadId: '01a16411-1120-7012-99ec-710e87e01fa5',
      input: [{ type: 'text', text: 'do it', text_elements: [] }],
      effort: 'low',
      approvalPolicy: 'untrusted'
    })
    expect(sent[8]).toEqual({ jsonrpc: '2.0', id: 0, result: { decision: 'accept' } })
    expect(sent[11]!.params).toMatchObject({ turnId: '01a16411-3802-7cc1-89d6-31ba12ef7f39' })
  })

  it('turns the recording into chat events', () => {
    const { events } = replay()
    expect(events.find((e) => e.t === 'session')).toEqual({
      t: 'session',
      id: '01a16411-1120-7012-99ec-710e87e01fa5',
      model: 'gpt-6.1-sol'
    })
    const caps = events.filter((e) => e.t === 'capabilities') as Extract<
      ChatEvent,
      { t: 'capabilities' }
    >[]
    expect(caps.find((c) => c.models.length)!.models[0]).toMatchObject({
      value: 'gpt-6.1-sol',
      label: 'GPT-6.1-Sol',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max']
    })
    // The last one has both halves.
    expect(caps.at(-1)!.models).toHaveLength(7)
    expect(caps.at(-1)!.account).toEqual({
      email: 'me@example.com',
      plan: 'ChatGPT team'
    })
    expect(events.find((e) => e.t === 'limits')).toMatchObject({
      limits: {
        fiveHour: { utilization: 0, resetsAt: 1792692210000 },
        sevenDay: { utilization: 0.72 }
      }
    })
    const approvals = events.filter((e) => e.t === 'approval')
    expect(approvals[0]).toMatchObject({
      name: 'Shell',
      subtitle: 'echo hi > c.txt',
      canAlways: true
    })
    expect(events).toContainEqual({ t: 'notice', level: 'info', text: 'Interrupted' })
    expect(events.filter((e) => e.t === 'turnEnd')).toHaveLength(3)
    expect(events.filter((e) => e.t === 'busy')).toEqual([
      { t: 'busy', busy: false },
      { t: 'busy', busy: false },
      { t: 'busy', busy: false }
    ])

    let t = addUserMessage(EMPTY_THREAD, 'do it', 0, 1000)
    t = events.reduce((th, e) => applyChatEvent(th, e, 1000), t)
    const tools = t.items.filter((it) => it.kind === 'tool')
    expect(tools).toHaveLength(2)
    expect(tools[0]).toMatchObject({
      subtitle: 'echo hi > c.txt',
      output: 'Exit code 0',
      isError: false
    })
    const text = t.items
      .filter((it) => it.kind === 'assistant')
      .map((it) => (it as { text: string }).text)
    expect(text).toContain('done')
    expect(text.join('')).toContain('update notes.txt')
  })

  it('holds a message until the thread is ready, and an early stop until the turn starts', () => {
    const a = createCodexAdapter()
    a.args(base)
    a.hello()
    expect(a.user('early', [])).toBeNull()
    const ready = a.decode({ id: 1, result: {} }).replies as Line[]
    const start = ready.find((m) => m.method === 'thread/start')!
    const replies = a.decode({ id: start.id, result: { thread: { id: 't1' }, model: 'm' } })
      .replies as Line[]
    expect(replies.map((m) => m.method)).toEqual(['turn/start'])
    expect(a.interrupt()).toBeNull()
    const on = a.decode({ method: 'turn/started', params: { turn: { id: 'u1' } } })
      .replies as Line[]
    expect(on[0]).toMatchObject({
      method: 'turn/interrupt',
      params: { threadId: 't1', turnId: 'u1' }
    })
  })

  it('resumes by thread id, and starts anew when codex no longer has it', () => {
    const a = createCodexAdapter()
    a.args({ ...base, sessionId: 'old' })
    a.hello()
    const ready = a.decode({ id: 1, result: {} }).replies as Line[]
    const resume = ready.find((m) => m.method === 'thread/resume')!
    expect(resume.params).toMatchObject({ threadId: 'old' })
    const out = a.decode({ id: resume.id, error: { message: 'no rollout found' } })
    expect(out.events[0]).toMatchObject({ t: 'notice', level: 'info' })
    expect((out.replies as Line[])[0]!.method).toBe('thread/start')
  })

  it('mode and model go with the next turn; the answers codex wants', () => {
    const a = createCodexAdapter()
    a.args(base)
    a.hello()
    const ready = a.decode({ id: 1, result: {} }).replies as Line[]
    const start = ready.find((m) => m.method === 'thread/start')!
    a.decode({ id: start.id, result: { thread: { id: 't1' } } })
    expect(a.setMode?.('bypassPermissions')).toBeNull()
    expect(a.setModel('gpt-mini')).toBeNull()
    expect((a.user('x', []) as Line).params).toMatchObject({
      model: 'gpt-mini',
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' }
    })
    a.decode({
      id: 7,
      method: 'item/fileChange/requestApproval',
      params: { itemId: 'f1', reason: 'write' }
    })
    expect(a.answer('cx-7', 'always')).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { decision: 'acceptForSession' }
    })
    a.decode({ id: 8, method: 'execCommandApproval', params: { command: ['ls'] } })
    expect(a.answer('cx-8', 'deny')).toEqual({
      jsonrpc: '2.0',
      id: 8,
      result: { decision: 'denied' }
    })
    // Requests for a richer host get a refusal, so codex doesn't wait for ever.
    expect(
      a.decode({ id: 9, method: 'item/tool/requestUserInput', params: {} }).replies[0]
    ).toMatchObject({
      id: 9,
      error: { code: -32601 }
    })
  })

  it('draws edits with their diff and hides hidden models', () => {
    expect(
      describeCodexItem({
        type: 'fileChange',
        changes: [{ path: 'a.ts', kind: { type: 'update' }, diff: '-a\n+b' }]
      })
    ).toEqual({
      name: 'Edit',
      kind: 'edit',
      subtitle: 'a.ts',
      preview: { type: 'code', text: '-a\n+b' }
    })
    expect(
      parseCodexModels({
        data: [
          { id: 'x', hidden: true },
          { id: 'y', displayName: 'Y' }
        ]
      }).map((m) => m.value)
    ).toEqual(['y'])
  })

  it('lists codex skills for the $ menu and sends the named ones as skill inputs (#96)', () => {
    // Shape from codex-cli 0.164.0's `skills/list` schema.
    const listed = {
      data: [
        {
          cwd: '/p',
          errors: [],
          skills: [
            {
              name: 'review',
              path: '/h/skills/review/SKILL.md',
              description: 'Long text',
              shortDescription: 'Review the diff',
              enabled: true,
              scope: 'user'
            },
            {
              name: 'off',
              path: '/h/skills/off/SKILL.md',
              description: '',
              enabled: false,
              scope: 'user'
            },
            {
              name: 'review',
              path: '/p/.codex/skills/review/SKILL.md',
              description: 'dup',
              enabled: true,
              scope: 'repo'
            }
          ]
        }
      ]
    }
    expect(parseCodexSkills(listed)).toEqual([
      { name: 'review', path: '/h/skills/review/SKILL.md', description: 'Review the diff' }
    ])

    const a = createCodexAdapter()
    a.args(base)
    a.hello()
    const ready = a.decode({ id: 1, result: {} }).replies as Line[]
    const list = ready.find((m) => m.method === 'skills/list')!
    const ev = a.decode({ id: list.id, result: listed }).events
    expect(ev[0]).toMatchObject({
      t: 'capabilities',
      commands: [{ name: 'review', description: 'Review the diff', mention: true }]
    })
    const start = ready.find((m) => m.method === 'thread/start')!
    a.decode({ id: start.id, result: { thread: { id: 't1' } } })
    expect((a.user('$review the diff, not $5', []) as Line).params).toMatchObject({
      input: [
        { type: 'text', text: '$review the diff, not $5' },
        { type: 'skill', name: 'review', path: '/h/skills/review/SKILL.md' }
      ]
    })
    expect((a.user('no skill here', []) as Line).params).toMatchObject({
      input: [{ type: 'text' }]
    })
    // A skill file changed: ask again, past codex's cache.
    const again = a.decode({ method: 'skills/changed', params: {} }).replies as Line[]
    expect(again[0]).toMatchObject({ method: 'skills/list', params: { forceReload: true } })
  })
})
