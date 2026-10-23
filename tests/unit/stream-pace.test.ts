import { describe, expect, it } from 'vitest'
import { BASE_CPS, CATCH_UP_S, paceStep, revealed } from '../../src/renderer/lib/stream-pace'
import { parseMarkdown, settledLength } from '../../src/renderer/lib/markdown'

describe('stream pacing (#52)', () => {
  it('reveals a little at a time at the base rate when little is waiting', () => {
    // 20 chars waiting, one 60 Hz frame: 90 cps × 16.7 ms ≈ 1.5 → 2 chars.
    expect(paceStep(0, 20, 1000 / 60)).toBe(2)
    expect(paceStep(20, 20, 16)).toBe(20)
    expect(paceStep(30, 20, 16)).toBe(20)
    // Always moves, even on a tiny frame.
    expect(paceStep(0, 5, 0)).toBe(1)
  })

  it('speeds up with the backlog so it never falls far behind', () => {
    // 3000 chars arrive at once: one second of frames shows nearly all of it.
    let shown = 0
    for (let f = 0; f < 60; f++) shown = paceStep(shown, 3000, 1000 / 60)
    expect(shown).toBeGreaterThan(3000 * 0.8)
    expect(shown).toBeLessThanOrEqual(3000)
    // A big backlog moves faster than the base rate.
    expect(paceStep(0, 3000, 16)).toBeGreaterThan(Math.round((BASE_CPS * 16) / 1000))
    expect(CATCH_UP_S).toBeLessThanOrEqual(1)
  })

  it('a long frame (hidden window) counts as 100 ms, never a jump to the end', () => {
    expect(paceStep(0, 100_000, 5000)).toBe(paceStep(0, 100_000, 100))
    expect(paceStep(0, 100_000, -5)).toBe(1)
  })

  it('never cuts an emoji in half', () => {
    expect(revealed('a😀b', 2)).toBe('a😀')
    expect(revealed('a😀b', 1)).toBe('a')
    expect(revealed('abc', 10)).toBe('abc')
  })
})

describe('settled part of a growing answer (#52)', () => {
  it('ends after the last blank line', () => {
    const s = 'one\n\ntwo\nthree\n\nfour'
    expect(s.slice(settledLength(s))).toBe('four')
    expect(settledLength('no blank line yet')).toBe(0)
    expect(settledLength('')).toBe(0)
  })

  it('never inside a code fence, open or not', () => {
    const open = 'intro\n\n```ts\nconst a = 1\n\nconst b = 2'
    expect(open.slice(settledLength(open))).toBe('```ts\nconst a = 1\n\nconst b = 2')
    const closed = '```\nx\n\ny\n```\n\nafter'
    expect(closed.slice(settledLength(closed))).toBe('after')
    const tilde = '~~~\n```\n\n~~~\n\nend'
    expect(tilde.slice(settledLength(tilde))).toBe('end')
  })

  it('the two halves parse to the same blocks as the whole', () => {
    const texts = [
      '# Title\n\nSome **bold** text.\n\n- a\n- b\n\n1. x\n2. y\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x\n\nx = 1\n```\n\ntail',
      'para one\nstill one\n\n---\n\n- [ ] task\n  wrapped\n\nend',
      '```\nnot closed\n\nyet'
    ]
    for (const t of texts) {
      for (let n = 0; n <= t.length; n++) {
        const s = t.slice(0, n)
        const cut = settledLength(s)
        expect([...parseMarkdown(s.slice(0, cut)), ...parseMarkdown(s.slice(cut))]).toEqual(
          parseMarkdown(s)
        )
      }
    }
  })
})
