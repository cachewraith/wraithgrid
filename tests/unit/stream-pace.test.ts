import { describe, expect, it } from 'vitest'
import {
  BASE_CPS,
  CATCH_UP_S,
  paceStep,
  revealed,
  revealedWords
} from '../../src/renderer/lib/stream-pace'
import {
  parseInline,
  parseMarkdown,
  scanSettled,
  settledLength
} from '../../src/renderer/lib/markdown'

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

describe('settled scan carried on as text grows (#141)', () => {
  const t =
    '# Title\n\nSome **bold** text.\n\n- a\n- b\n\n```js\nlet x\n\nx = 1\n```\n\n> quote\n\ntail\n\n\nend'

  it('a resumed scan finds the same cuts as a fresh one, and each piece parses alone', () => {
    let scan = scanSettled('')
    for (let n = 1; n <= t.length; n++) {
      const s = t.slice(0, n)
      scan = scanSettled(s, scan)
      expect(scan.cuts).toEqual(scanSettled(s).cuts)
      const ends = [0, ...scan.cuts, s.length]
      const pieces = ends.slice(1).flatMap((end, i) => parseMarkdown(s.slice(ends[i], end)))
      expect(pieces).toEqual(parseMarkdown(s))
    }
  })

  it('starts over when the text was replaced, not grown', () => {
    const a = scanSettled('one\n\ntwo\n\n')
    expect(scanSettled('other\nthing', a).cuts).toEqual([])
  })
})

describe('emphasis stays linear (#141)', () => {
  it('snake_case and unmatched marks parse fast and stay plain', () => {
    const snake = 'a_b_c '.repeat(20_000)
    const stars = '*a '.repeat(20_000)
    const t0 = performance.now()
    expect(parseInline(snake)).toEqual([{ t: 'text', v: snake }])
    expect(parseInline(stars)).toEqual([{ t: 'text', v: stars }])
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(parseInline('some *it* and _x_ and **b**')).toEqual([
      { t: 'text', v: 'some ' },
      { t: 'i', c: [{ t: 'text', v: 'it' }] },
      { t: 'text', v: ' and ' },
      { t: 'i', c: [{ t: 'text', v: 'x' }] },
      { t: 'text', v: ' and ' },
      { t: 'b', c: [{ t: 'text', v: 'b' }] }
    ])
  })
})

describe('word-at-a-time reveal (#62)', () => {
  it('cuts back to the end of the last whole word', () => {
    expect(revealedWords('Hello world foo', 8)).toBe('Hello')
    expect(revealedWords('Hello world foo', 11)).toBe('Hello world')
    expect(revealedWords('Hello world foo', 3)).toBe('')
  })
  it('shows everything once all of it is revealed', () => {
    expect(revealedWords('Hello world', 11)).toBe('Hello world')
    expect(revealedWords('Hello', 99)).toBe('Hello')
  })
  it('breaks at newlines too and never splits an emoji', () => {
    expect(revealedWords('one\ntwo three', 6)).toBe('one')
    expect(revealedWords('hi 😀😀 there', 5)).toBe('hi')
  })
})
