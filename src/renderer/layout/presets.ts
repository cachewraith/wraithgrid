import type { LayoutNode } from '@shared/types'
import { isLeaf, split } from './tree'

export type PresetId = '1' | '2' | '4' | '3'

export interface Preset {
  id: PresetId
  label: string
  slots: number
}

/** Ordered as the prototype's segmented control: 1, 2 side by side, 2×2, 3 columns. */
export const PRESETS: readonly Preset[] = [
  { id: '1', label: '1 pane', slots: 1 },
  { id: '2', label: '2 side by side', slots: 2 },
  { id: '4', label: '2×2 grid', slots: 4 },
  { id: '3', label: '3 columns', slots: 3 }
]

/**
 * Rebuilds the tree for a preset. Panes fill slots in order; leftover panes stay in the
 * workspace but hidden; missing panes become empty "New pane here" slots.
 */
export function buildPreset(
  id: PresetId,
  orderedPaneIds: string[],
  newSlotId: () => string
): LayoutNode {
  const preset = PRESETS.find((p) => p.id === id)!
  const cells: LayoutNode[] = Array.from({ length: preset.slots }, (_, i) => {
    const paneId = orderedPaneIds[i]
    return paneId ? { type: 'pane', paneId } : { type: 'empty', slotId: newSlotId() }
  })
  switch (id) {
    case '1':
      return cells[0]!
    case '2':
    case '3':
      return split('row', cells)
    case '4':
      return split('col', [split('row', cells.slice(0, 2)), split('row', cells.slice(2, 4))])
  }
}

const evenly = (sizes: number[]): boolean =>
  sizes.every((s) => Math.abs(s - 100 / sizes.length) < 0.5)

/** Which preset the tree matches exactly (shape and even sizes), if any. */
export function detectPreset(node: LayoutNode | null): PresetId | null {
  if (!node) return null
  if (isLeaf(node)) return '1'
  if (node.dir === 'row' && node.children.every(isLeaf) && evenly(node.sizes)) {
    if (node.children.length === 2) return '2'
    if (node.children.length === 3) return '3'
  }
  if (
    node.dir === 'col' &&
    node.children.length === 2 &&
    evenly(node.sizes) &&
    node.children.every(
      (r) =>
        r.type === 'split' &&
        r.dir === 'row' &&
        r.children.length === 2 &&
        r.children.every(isLeaf) &&
        evenly(r.sizes)
    )
  ) {
    return '4'
  }
  return null
}
