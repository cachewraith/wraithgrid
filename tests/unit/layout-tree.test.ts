import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '@shared/types'
import { neighborInDirection, type Rect } from '../../src/renderer/layout/focus'
import { buildPreset, detectPreset } from '../../src/renderer/layout/presets'
import {
  autoGrid,
  emptySlotIds,
  fillSlot,
  isRegularGrid,
  normalizeLayout,
  paneIds,
  placeNewPane,
  removePane,
  setSizesAt,
  shapeKey,
  splitPane,
  swapPanes
} from '../../src/renderer/layout/tree'

const pane = (paneId: string): LayoutNode => ({ type: 'pane', paneId })
const slotIds = (): (() => string) => {
  let n = 0
  return () => `s${++n}`
}

describe('layout tree', () => {
  it('lists panes in reading order', () => {
    const t = buildPreset('4', ['a', 'b', 'c', 'd'], slotIds())
    expect(paneIds(t)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('removing a pane collapses its split and renormalizes sizes', () => {
    const t: LayoutNode = {
      type: 'split',
      dir: 'row',
      sizes: [20, 30, 50],
      children: [pane('a'), pane('b'), pane('c')]
    }
    const r = removePane(t, 'b')!
    expect(r.type).toBe('split')
    if (r.type !== 'split') return
    expect(paneIds(r)).toEqual(['a', 'c'])
    expect(r.sizes[0]).toBeCloseTo((20 / 70) * 100)
    expect(r.sizes[1]).toBeCloseTo((50 / 70) * 100)
  })

  it('removing the last pane of a two-way split leaves the sibling', () => {
    const t = buildPreset('2', ['a', 'b'], slotIds())
    expect(removePane(t, 'a')).toEqual(pane('b'))
    expect(removePane(pane('a'), 'a')).toBeNull()
  })

  it('normalizes away unknown and duplicate panes but keeps empty slots', () => {
    const t: LayoutNode = {
      type: 'split',
      dir: 'row',
      sizes: [1, 1, 1, 1],
      children: [pane('a'), pane('ghost'), pane('a'), { type: 'empty', slotId: 's1' }]
    }
    const n = normalizeLayout(t, ['a'])!
    expect(paneIds(n)).toEqual(['a'])
    expect(emptySlotIds(n)).toEqual(['s1'])
  })

  it('splitting inside a same-direction split adds a sibling sharing the space', () => {
    const t: LayoutNode = {
      type: 'split',
      dir: 'row',
      sizes: [50, 50],
      children: [pane('a'), pane('b')]
    }
    const r = splitPane(t, 'a', 'x', 'row')
    expect(r).toMatchObject({
      type: 'split',
      dir: 'row',
      children: [pane('a'), pane('x'), pane('b')]
    })
    if (r.type === 'split') expect(r.sizes).toEqual([25, 25, 50])
  })

  it('splitting across directions nests a new split', () => {
    const t: LayoutNode = {
      type: 'split',
      dir: 'row',
      sizes: [50, 50],
      children: [pane('a'), pane('b')]
    }
    const r = splitPane(t, 'b', 'x', 'col')
    expect(shapeKey(r)).toBe('row(p-a,col(p-b,p-x))')
  })

  it('fills an empty slot and swaps panes', () => {
    const t = buildPreset('2', ['a'], slotIds())
    const filled = fillSlot(t, 's1', 'b')
    expect(paneIds(filled)).toEqual(['a', 'b'])
    expect(paneIds(swapPanes(filled, 'a', 'b'))).toEqual(['b', 'a'])
  })

  it('stores dragged sizes at a path', () => {
    const t = buildPreset('4', ['a', 'b', 'c', 'd'], slotIds())
    const r = setSizesAt(t, [1], [30, 70])
    expect(r.type === 'split' && r.children[1]!.type === 'split' && r.children[1]!.sizes).toEqual([
      30, 70
    ])
    // Mismatched length is ignored.
    expect(setSizesAt(t, [1], [100])).toEqual(t)
  })

  it('auto-arranges any pane count', () => {
    expect(autoGrid([])).toBeNull()
    expect(shapeKey(autoGrid(['a'])!)).toBe('p-a')
    expect(shapeKey(autoGrid(['a', 'b', 'c'])!)).toBe('row(p-a,p-b,p-c)')
    expect(shapeKey(autoGrid(['a', 'b', 'c', 'd'])!)).toBe('col(row(p-a,p-b),row(p-c,p-d))')
    const eight = autoGrid(['1', '2', '3', '4', '5', '6', '7', '8'])!
    expect(shapeKey(eight)).toBe('col(row(p-1,p-2,p-3,p-4),row(p-5,p-6,p-7,p-8))')
    expect(shapeKey(autoGrid(['a', 'b', 'c', 'd', 'e'])!)).toBe(
      'col(row(p-a,p-b,p-c),row(p-d,p-e))'
    )
  })
})

describe('placing a new pane', () => {
  it('fills the requested slot, else the first empty slot', () => {
    const t = buildPreset('4', ['a'], slotIds()) // slots s1..s3
    expect(emptySlotIds(placeNewPane(t, 'x', { slotId: 's2' }))).toEqual(['s1', 's3'])
    expect(emptySlotIds(placeNewPane(t, 'x'))).toEqual(['s2', 's3'])
  })

  it('keeps a regular grid regular, up to 4×2', () => {
    let t: LayoutNode | null = null
    for (const id of ['1', '2', '3', '4', '5', '6', '7', '8']) t = placeNewPane(t, id)
    expect(shapeKey(t!)).toBe('col(row(p-1,p-2,p-3,p-4),row(p-5,p-6,p-7,p-8))')
    expect(isRegularGrid(t)).toBe(true)
  })

  it('splits the target pane of a custom tree', () => {
    const custom = splitPane(buildPreset('2', ['a', 'b'], slotIds()), 'b', 'c', 'col')
    expect(isRegularGrid(custom)).toBe(false)
    expect(shapeKey(placeNewPane(custom, 'x', { targetId: 'a', dir: 'col' }))).toBe(
      'row(col(p-a,p-x),col(p-b,p-c))'
    )
  })
})

describe('presets', () => {
  it('builds each preset with empty slots for missing panes', () => {
    const one = buildPreset('1', [], slotIds())
    expect(one).toEqual({ type: 'empty', slotId: 's1' })
    const cols = buildPreset('3', ['a'], slotIds())
    expect(paneIds(cols)).toEqual(['a'])
    expect(emptySlotIds(cols)).toHaveLength(2)
  })

  it('leaves panes that do not fit out of the tree (hidden)', () => {
    const t = buildPreset('2', ['a', 'b', 'c', 'd'], slotIds())
    expect(paneIds(t)).toEqual(['a', 'b'])
  })

  it('detects the preset a tree matches', () => {
    for (const id of ['1', '2', '4', '3'] as const) {
      expect(detectPreset(buildPreset(id, ['a', 'b', 'c', 'd'], slotIds()))).toBe(id)
    }
    const resized = setSizesAt(buildPreset('2', ['a', 'b'], slotIds()), [], [30, 70])
    expect(detectPreset(resized)).toBeNull()
    expect(detectPreset(null)).toBeNull()
  })
})

describe('focus navigation', () => {
  // 2x2 grid of 100x100 cells with a 6px gap.
  const rects: Record<string, Rect> = {
    a: { left: 0, top: 0, width: 100, height: 100 },
    b: { left: 106, top: 0, width: 100, height: 100 },
    c: { left: 0, top: 106, width: 100, height: 100 },
    d: { left: 106, top: 106, width: 100, height: 100 }
  }

  it('moves to the nearest pane in each direction', () => {
    expect(neighborInDirection(rects, 'a', 'right')).toBe('b')
    expect(neighborInDirection(rects, 'a', 'down')).toBe('c')
    expect(neighborInDirection(rects, 'd', 'left')).toBe('c')
    expect(neighborInDirection(rects, 'd', 'up')).toBe('b')
  })

  it('stops at the edge', () => {
    expect(neighborInDirection(rects, 'a', 'left')).toBeNull()
    expect(neighborInDirection(rects, 'a', 'up')).toBeNull()
  })

  it('prefers a pane sharing the span over a diagonal one', () => {
    const r: Record<string, Rect> = {
      tall: { left: 0, top: 0, width: 100, height: 206 },
      top: { left: 106, top: 0, width: 100, height: 100 },
      bottom: { left: 106, top: 106, width: 100, height: 100 }
    }
    expect(neighborInDirection(r, 'bottom', 'left')).toBe('tall')
    expect(neighborInDirection(r, 'tall', 'right')).toBe('top')
  })
})
