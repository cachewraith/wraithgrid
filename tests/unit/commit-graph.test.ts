import { describe, expect, it } from 'vitest'
import { layoutGraph, refLabels } from '../../src/renderer/lib/commit-graph'
import { parseLog } from '../../src/main/git'

const c = (sha: string, ...parents: string[]) => ({ sha, parents })
const edges = (e: { from: number; to: number }[]) => e.map((x) => `${x.from}>${x.to}`).sort()

describe('history graph lanes', () => {
  it('a straight line stays in column 0', () => {
    const rows = layoutGraph([c('a', 'b'), c('b', 'c'), c('c')])
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0])
    expect(edges(rows[0]!.top)).toEqual([]) // the tip starts at its node
    expect(edges(rows[0]!.bottom)).toEqual(['0>0'])
    expect(edges(rows[2]!.bottom)).toEqual([]) // the root ends at its node
    expect(rows.every((r) => r.width === 1)).toBe(true)
  })

  it('a merge opens a lane for the second parent and it joins back at the fork', () => {
    // m merges f1 (feature) into b1 (main); both started at b0.
    const rows = layoutGraph([c('m', 'b1', 'f1'), c('f1', 'b0'), c('b1', 'b0'), c('b0')])
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 0])
    expect(edges(rows[0]!.bottom)).toEqual(['0>0', '0>1'])
    expect(edges(rows[1]!.top)).toEqual(['0>0', '1>1'])
    // b1's parent b0 already waits in lane 1: that lane comes back to column 0.
    expect(edges(rows[2]!.bottom)).toEqual(['0>0', '1>0'])
    expect(edges(rows[3]!.top)).toEqual(['0>0'])
    expect(rows[1]!.width).toBe(2)
    // Lanes keep a color: the feature lane differs from main.
    expect(rows[1]!.color).not.toBe(rows[0]!.color)
  })

  it('two branch tips: the second starts in a new column', () => {
    const rows = layoutGraph([c('x', 'base'), c('y', 'base'), c('base')])
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0])
    expect(edges(rows[1]!.top)).toEqual(['0>0'])
    // y's parent already has a lane: its line joins it right away.
    expect(edges(rows[1]!.bottom)).toEqual(['0>0', '1>0'])
    expect(edges(rows[2]!.top)).toEqual(['0>0'])
  })

  it('labels refs by kind', () => {
    expect(refLabels(['HEAD -> main', 'origin/main', 'tag: v1.2.0', 'feat'])).toEqual([
      { text: 'main', kind: 'head' },
      { text: 'origin/main', kind: 'remote' },
      { text: 'v1.2.0', kind: 'tag' },
      { text: 'feat', kind: 'branch' }
    ])
  })
})

describe('git log parsing', () => {
  it('reads the fields and drops bad rows', () => {
    const sha = 'a'.repeat(40)
    const p1 = 'b'.repeat(40)
    const p2 = 'c'.repeat(40)
    const out =
      [sha, `${p1} ${p2}`, 'Ada', '1700000000', 'HEAD -> main, tag: v1', 'Merge feat'].join(
        '\x1f'
      ) +
      '\x1e\n' +
      ['nope', '', '', '', '', 'bad'].join('\x1f') +
      '\x1e\n'
    expect(parseLog(out)).toEqual([
      {
        sha,
        parents: [p1, p2],
        author: 'Ada',
        time: 1_700_000_000_000,
        refs: ['HEAD -> main', 'tag: v1'],
        subject: 'Merge feat'
      }
    ])
  })
})
