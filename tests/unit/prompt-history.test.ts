import { describe, expect, it } from 'vitest'
import {
  NOT_BROWSING,
  atEdge,
  historyStep,
  promptHistory,
  type HistoryNav
} from '../../src/renderer/lib/prompt-history'

describe('prompt history in the chat box (#132)', () => {
  it('is the chat’s sent prompts, oldest first, a repeat stored once', () => {
    const items = [
      { kind: 'user', text: 'fix the build' },
      { kind: 'assistant', text: 'done' },
      { kind: 'user', text: 'fix the build' },
      { kind: 'tool' },
      { kind: 'user', text: '  run the tests ' },
      { kind: 'user', text: '' },
      { kind: 'user', text: 'fix the build' },
      // Attached file paths are not part of what was typed; files alone recall nothing.
      { kind: 'user', text: 'read these\n\nAttached files:\n- /tmp/a.txt\n- /tmp/b.txt' },
      { kind: 'user', text: 'Attached files:\n- /tmp/c.txt' }
    ]
    expect(promptHistory(items)).toEqual([
      'fix the build',
      'run the tests',
      'fix the build',
      'read these'
    ])
  })

  it('↑ goes back, ↓ comes forward and past the newest brings the draft back', () => {
    const list = ['one', 'two', 'three']
    let nav: HistoryNav = NOT_BROWSING
    const step = (dir: -1 | 1, current: string): string | null => {
      const r = historyStep(list, nav, dir, current)
      if (!r) return null
      nav = r.nav
      return r.text
    }
    expect(step(1, 'my draft')).toBeNull()
    expect(step(-1, 'my draft')).toBe('three')
    expect(step(-1, 'three')).toBe('two')
    expect(step(-1, 'two')).toBe('one')
    expect(step(-1, 'one')).toBeNull()
    expect(step(1, 'one')).toBe('two')
    expect(step(1, 'two')).toBe('three')
    expect(step(1, 'three')).toBe('my draft')
    expect(nav).toEqual(NOT_BROWSING)
    expect(historyStep([], NOT_BROWSING, -1, 'x')).toBeNull()
  })

  it('only steps from the first line (↑) or the last line (↓), with no selection', () => {
    const text = 'first line\nsecond line\nthird'
    expect(atEdge(text, 3, 3, -1)).toBe(true)
    expect(atEdge(text, 14, 14, -1)).toBe(false)
    expect(atEdge(text, 14, 14, 1)).toBe(false)
    expect(atEdge(text, text.length - 1, text.length - 1, 1)).toBe(true)
    expect(atEdge(text, 0, 5, -1)).toBe(false)
    expect(atEdge('', 0, 0, -1)).toBe(true)
    expect(atEdge('', 0, 0, 1)).toBe(true)
  })
})
