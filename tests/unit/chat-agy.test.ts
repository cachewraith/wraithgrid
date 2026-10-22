import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@shared/chat'
import { AGENT_CLI_SPECS } from '@shared/agent-clis'
import { chatAdapterFor } from '../../src/main/chat/adapter'
import { createAgyAdapter, describeAgyTool, parseAgyModels } from '../../src/main/chat/agy'
import {
  EMPTY_THREAD,
  addUserMessage,
  applyChatEvent,
  chatStatus
} from '../../src/renderer/lib/chat-thread'

// Real agy 1.4.4 output (tool list and home path taken out).
const load = (name: string): unknown[] =>
  readFileSync(path.join(__dirname, `../fixtures/${name}`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown)
// A command and an edit, then two more messages (the second sent while the first ran).
const CHAT = load('agy-chat.ndjson')
// A command that needed approval, refused because headless agy can't ask.
const DENIED = load('agy-denied.ndjson')

const decodeAll = (msgs: unknown[]): ChatEvent[] => {
  const a = createAgyAdapter()
  return msgs.flatMap((m) => a.decode(m).events)
}

describe('agy chat adapter (#41)', () => {
  it('is registered and the CLI has the chat view and a terminal resume', () => {
    expect(chatAdapterFor('agy')).not.toBeNull()
    expect(AGENT_CLI_SPECS.agy.chat).toBe(true)
    expect(AGENT_CLI_SPECS.agy.resumeArgs).toEqual(['--continue'])
  })

  it('runs agy headless with stream-json; resume, model, effort and mode as flags', () => {
    parseAgyModels('gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-sonnet-4-6\tClaude')
    const a = createAgyAdapter()
    const base = { continueLast: false, model: null, effort: null }
    expect(a.args({ ...base, sessionId: null })).toEqual([
      '--print=',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json'
    ])
    expect(a.args({ ...base, sessionId: 'c-1' }).slice(-2)).toEqual(['--conversation', 'c-1'])
    expect(a.args({ ...base, sessionId: null, continueLast: true }).at(-1)).toBe('--continue')
    expect(
      a.args({ sessionId: null, continueLast: false, model: 'gemini-3.8-flash', effort: 'low' })
    ).toContain('--effort')
    // A model without levels refuses --effort: leave it out.
    expect(
      a.args({ sessionId: null, continueLast: false, model: 'claude-sonnet-4-6', effort: 'low' })
    ).not.toContain('--effort')
    expect(a.args({ ...base, sessionId: null, mode: 'plan' }).slice(-2)).toEqual(['--mode', 'plan'])
    expect(a.args({ ...base, sessionId: null, mode: 'bypassPermissions' }).at(-1)).toBe(
      '--dangerously-skip-permissions'
    )
    expect(a.user('hi', [])).toEqual({
      event: 'user',
      message: { role: 'user', content: 'hi' }
    })
    // Nothing of these goes over agy's pipe: the view restarts it instead.
    expect(a.interrupt()).toBeNull()
    expect(a.setModel('x')).toBeNull()
    expect(a.setMode?.('plan')).toBeNull()
  })

  it('folds the per-level model ids of `agy models` into one model with efforts', () => {
    const models = parseAgyModels(
      [
        'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
        'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
        'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
        'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)',
        'Fetching available models...',
        ''
      ].join('\n')
    )
    expect(models).toEqual([
      {
        value: 'gemini-3.8-flash',
        label: 'Gemini 3.8 Flash',
        description: '',
        efforts: ['low', 'medium', 'high']
      },
      {
        value: 'claude-opus-4-6-thinking',
        label: 'Claude Opus 4.6 (Thinking)',
        description: '',
        efforts: []
      }
    ])
  })

  it('decodes a real conversation: session, controls, streamed text, tools, turn ends', () => {
    const events = decodeAll(CHAT)
    expect(events[0]).toEqual({
      t: 'session',
      id: 'ad7ddba0-cf3f-47d8-a323-a79d3047ca0f',
      model: 'claude-sonnet-4-6'
    })
    expect(events[1]).toMatchObject({
      t: 'controls',
      controls: { live: { interrupt: false, model: false, mode: false }, approvals: false }
    })
    const tools = events.filter((e) => e.t === 'tool') as Extract<ChatEvent, { t: 'tool' }>[]
    expect(tools[0]).toMatchObject({
      name: 'run_command',
      kind: 'shell',
      subtitle: 'echo wg-test > /tmp/agytest/b.txt'
    })
    expect(tools.some((x) => x.name === 'write_file' && x.kind === 'edit')).toBe(true)
    expect(events).toContainEqual(
      expect.objectContaining({
        t: 'toolResult',
        output: 'Command exited with code 0.\n\nNo output from the command.',
        isError: false
      })
    )
    // One result, and one turn end, per message.
    expect(events.filter((e) => e.t === 'turnEnd')).toHaveLength(3)
    expect(events.filter((e) => e.t === 'busy')).toHaveLength(3)

    let t = addUserMessage(EMPTY_THREAD, 'go', 0, 1000)
    t = events.reduce((th, e) => applyChatEvent(th, e, 1000), t)
    const text = t.items
      .filter((it) => it.kind === 'assistant')
      .map((it) => (it as { text: string }).text)
      .join('')
    expect(text).toContain("I'll run both tasks in parallel!")
    expect(text).toContain('OK.')
    expect(chatStatus(t)).toBe('idle')
    expect(t.controls?.modes).toEqual(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
  })

  it('says what it refused for want of an approval, and how to allow it', () => {
    const notices = decodeAll(DENIED).filter((e) => e.t === 'notice') as Extract<
      ChatEvent,
      { t: 'notice' }
    >[]
    expect(notices).toHaveLength(1)
    expect(notices[0]!.level).toBe('error')
    expect(notices[0]!.text).toContain('skipped: RunCommand')
    expect(notices[0]!.text).toContain('Bypass permissions')
  })

  it('a result answering several queued messages ends each of their turns', () => {
    const a = createAgyAdapter()
    const step = { event: 'step_update', step_update: { state: 'DONE', step_type: 'user_input' } }
    a.decode(step)
    a.decode(step)
    const ev = a.decode({ event: 'result', result: { status: 'SUCCESS' } }).events
    expect(ev.filter((e) => e.t === 'busy')).toHaveLength(2)
  })

  it('a failed turn is an error; a sign-in failure says how to sign in', () => {
    const a = createAgyAdapter()
    const ev = a.decode({
      event: 'result',
      result: { status: 'ERROR', error: 'Print mode: not authenticated' }
    }).events
    expect(ev[0]).toMatchObject({ t: 'notice', level: 'error' })
    expect((ev[0] as { text: string }).text).toContain('not signed in')
    expect(ev).toContainEqual(
      expect.objectContaining({ t: 'turnEnd', error: 'Print mode: not authenticated' })
    )
  })

  it('draws its tools by kind', () => {
    expect(describeAgyTool('view_file', { Path: '/a' })).toEqual({
      kind: 'read',
      subtitle: '/a',
      preview: null
    })
    expect(describeAgyTool('grep_search', { Query: 'foo' }).kind).toBe('search')
    expect(describeAgyTool('mystery', {}).kind).toBe('other')
  })
})
