import { describe, expect, it, vi } from 'vitest'
import type { WraithApi } from '@shared/ipc-contract'
import { ChatBus } from '../../src/renderer/lib/chat-bus'
import { buildHandoff } from '../../src/renderer/lib/chat-handoff'
import {
  EMPTY_THREAD,
  parseThread,
  serializeThread,
  type ChatItem
} from '../../src/renderer/lib/chat-thread'

const user = (text: string, id = text): Extract<ChatItem, { kind: 'user' }> => ({
  kind: 'user',
  id,
  text,
  images: 0
})
const assistant = (text: string): ChatItem => ({ kind: 'assistant', id: text, text })

describe('cross-CLI handoff', () => {
  it('carries visible user and assistant text in order, without thinking, tool output or notices', () => {
    const items: ChatItem[] = [
      user('fix the parser'),
      { kind: 'thinking', id: 't', text: 'PRIVATE' },
      { kind: 'notice', id: 'n', text: 'SECRET', level: 'info' },
      assistant('Fixed it.'),
      user('continue')
    ]
    const result = buildHandoff(items, 'claude', 'work')
    expect(result.messages).toBe(3)
    expect(result.text).toBe(
      'Continuing a conversation from Claude (work):\n\nuser: fix the parser\n\nassistant: Fixed it.\n\nuser: continue'
    )
  })
  it('keeps the newest messages when the turn cap is reached', () => {
    const result = buildHandoff(
      Array.from({ length: 100 }, (_, i) => user(`turn ${i}`)),
      'codex',
      'home'
    )
    expect(result.messages).toBe(60)
    expect(result.text).not.toContain('user: turn 39\n')
    expect(result.text).toContain('user: turn 40\n')
    expect(result.text.endsWith('user: turn 99')).toBe(true)
  })
  it('caps total characters, preserving the newest text and its role even for one huge message', () => {
    const result = buildHandoff(
      [user('old'), assistant('x'.repeat(30_000) + 'NEWEST')],
      'claude',
      'work'
    )
    expect(result.text.length).toBe(20_000)
    expect(result.messages).toBe(1)
    expect(result.text).toContain('assistant: ')
    expect(result.text.endsWith('NEWEST')).toBe(true)
    expect(result.text).not.toContain('user: old')
  })
  it('skips image-only/empty messages and excludes tool output and previous handoffs', () => {
    const tool: ChatItem = {
      kind: 'tool',
      id: 'tool',
      name: 'Bash',
      toolKind: 'shell',
      subtitle: 'SECRET',
      preview: null,
      output: 'SECRET',
      isError: false,
      approval: null
    }
    const result = buildHandoff(
      [user('  '), { ...user(''), images: 1 }, tool, assistant('done')],
      'claude',
      'work'
    )
    expect(result.messages).toBe(1)
    expect(result.text).not.toContain('SECRET')
  })
  it('drops damaged handoff provider metadata instead of passing it to the view', () => {
    const raw = serializeThread({
      ...EMPTY_THREAD,
      items: [
        {
          kind: 'handoff',
          id: 'h',
          text: 'hello',
          messages: 1,
          fromCli: 'claude',
          toCli: 'codex',
          divider: 'continued'
        }
      ]
    })
    expect(parseThread(raw.replace('"toCli":"codex"', '"toCli":"unknown"')).items).toEqual([])
  })
  it('persists the collapsed handoff with its provider and divider across reloads', () => {
    const handoff: ChatItem = {
      kind: 'handoff',
      id: 'h-1',
      ...buildHandoff([user('hello')], 'claude', 'work'),
      toCli: 'codex',
      divider: 'continued in Codex'
    }
    expect(parseThread(serializeThread({ ...EMPTY_THREAD, items: [handoff] })).items).toEqual([
      handoff
    ])
  })
})

// A stopped process may emit exit/capabilities after it was archived. Those events must
// never replace the saved source conversation with an empty thread.
it('ignores late source events after archiving and accepts events after reopening', async () => {
  type ChatApi = WraithApi['chat']
  type Envelope = Parameters<Parameters<ChatApi['onEvent']>[0]>[0]
  let emit: (e: Envelope) => void = () => {}
  const save = vi.fn()
  const bus = new ChatBus({
    onEvent: (cb: (e: Envelope) => void) => {
      emit = cb
      return () => {}
    },
    load: async () => null,
    save,
    send: vi.fn()
  } as unknown as ChatApi)
  vi.useFakeTimers()
  try {
    bus.start()
    await bus.load('source')
    emit({ paneId: 'source', event: { t: 'text', id: 'a', delta: 'original answer' } })
    bus.forget('source', true)
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]![1]).toContain('original answer')
    emit({ paneId: 'source', event: { t: 'exit', code: 0, signal: null, error: null } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledOnce()
    await bus.load('source')
    emit({ paneId: 'source', event: { t: 'text', id: 'b', delta: 'reopened answer' } })
    expect(bus.thread('source').items).toContainEqual({
      kind: 'assistant',
      id: 'b',
      text: 'reopened answer'
    })
    bus.forget('source')
    bus.stop()
  } finally {
    vi.useRealTimers()
  }
})
