// Pure operations on a workspace's split tree. Nothing here touches React or the DOM.
import type { LayoutNode, SplitDir } from '@shared/types'

export type Path = number[]

export function isLeaf(n: LayoutNode): n is Exclude<LayoutNode, { type: 'split' }> {
  return n.type !== 'split'
}

/** Leaves (panes and empty slots) in reading order. */
export function leaves(node: LayoutNode | null): Exclude<LayoutNode, { type: 'split' }>[] {
  if (!node) return []
  if (isLeaf(node)) return [node]
  return node.children.flatMap(leaves)
}

export function paneIds(node: LayoutNode | null): string[] {
  return leaves(node).flatMap((l) => (l.type === 'pane' ? [l.paneId] : []))
}

export function emptySlotIds(node: LayoutNode | null): string[] {
  return leaves(node).flatMap((l) => (l.type === 'empty' ? [l.slotId] : []))
}

export function containsPane(node: LayoutNode | null, paneId: string): boolean {
  return paneIds(node).includes(paneId)
}

/** Scales sizes so they sum to 100, falling back to equal shares. */
export function normalizeSizes(sizes: number[], count: number): number[] {
  const valid = sizes.length === count && sizes.every((s) => Number.isFinite(s) && s > 0)
  if (!valid) return Array.from({ length: count }, () => 100 / count)
  const total = sizes.reduce((a, b) => a + b, 0)
  return sizes.map((s) => (s / total) * 100)
}

export function split(dir: SplitDir, children: LayoutNode[], sizes?: number[]): LayoutNode {
  return { type: 'split', dir, children, sizes: normalizeSizes(sizes ?? [], children.length) }
}

/**
 * Drops leaves the predicate rejects, removes duplicate panes, collapses splits with a
 * single child and repairs sizes. Returns null when nothing is left.
 */
export function prune(
  node: LayoutNode | null,
  keep: (leaf: Exclude<LayoutNode, { type: 'split' }>) => boolean
): LayoutNode | null {
  const seen = new Set<string>()
  const walk = (n: LayoutNode): LayoutNode | null => {
    if (n.type === 'pane') {
      if (seen.has(n.paneId) || !keep(n)) return null
      seen.add(n.paneId)
      return n
    }
    if (n.type === 'empty') return keep(n) ? n : null
    const kept: { child: LayoutNode; size: number }[] = []
    n.children.forEach((c, i) => {
      const w = walk(c)
      if (w) kept.push({ child: w, size: n.sizes[i] ?? 0 })
    })
    if (kept.length === 0) return null
    if (kept.length === 1) return kept[0]!.child
    return split(
      n.dir,
      kept.map((k) => k.child),
      kept.map((k) => k.size)
    )
  }
  return node ? walk(node) : null
}

/** Keeps only panes the workspace still has. */
export function normalizeLayout(
  node: LayoutNode | null,
  validPaneIds: string[]
): LayoutNode | null {
  const valid = new Set(validPaneIds)
  return prune(node, (l) => l.type === 'empty' || valid.has(l.paneId))
}

export function removePane(node: LayoutNode | null, paneId: string): LayoutNode | null {
  return prune(node, (l) => !(l.type === 'pane' && l.paneId === paneId))
}

function mapLeaves(
  node: LayoutNode,
  fn: (leaf: Exclude<LayoutNode, { type: 'split' }>) => LayoutNode
): LayoutNode {
  if (isLeaf(node)) return fn(node)
  return { ...node, children: node.children.map((c) => mapLeaves(c, fn)) }
}

export function fillSlot(node: LayoutNode, slotId: string, paneId: string): LayoutNode {
  return mapLeaves(node, (l) =>
    l.type === 'empty' && l.slotId === slotId ? { type: 'pane', paneId } : l
  )
}

export function swapPanes(node: LayoutNode, a: string, b: string): LayoutNode {
  return mapLeaves(node, (l) => {
    if (l.type !== 'pane') return l
    if (l.paneId === a) return { type: 'pane', paneId: b }
    if (l.paneId === b) return { type: 'pane', paneId: a }
    return l
  })
}

/**
 * Puts `newPaneId` next to `targetId`. When the target already sits in a split of the
 * same direction the new pane becomes a sibling (sharing the target's space); otherwise
 * the target leaf becomes a two-way split.
 */
export function splitPane(
  node: LayoutNode,
  targetId: string,
  newPaneId: string,
  dir: SplitDir
): LayoutNode {
  const leaf: LayoutNode = { type: 'pane', paneId: newPaneId }
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.type === 'pane') return n.paneId === targetId ? split(dir, [n, leaf]) : n
    if (n.type === 'empty') return n
    const idx = n.children.findIndex((c) => c.type === 'pane' && c.paneId === targetId)
    if (idx >= 0 && n.dir === dir) {
      const children = [...n.children]
      const sizes = [...n.sizes]
      const half = (sizes[idx] ?? 0) / 2
      children.splice(idx + 1, 0, leaf)
      sizes.splice(idx, 1, half, half)
      return split(dir, children, sizes)
    }
    return { ...n, children: n.children.map(walk) }
  }
  return walk(node)
}

export function getAt(node: LayoutNode, path: Path): LayoutNode | null {
  let cur: LayoutNode | undefined = node
  for (const i of path) {
    if (!cur || cur.type !== 'split') return null
    cur = cur.children[i]
  }
  return cur ?? null
}

/** Stores a split's sizes after the user drags a divider. */
export function setSizesAt(node: LayoutNode, path: Path, sizes: number[]): LayoutNode {
  if (path.length === 0) {
    if (node.type !== 'split' || sizes.length !== node.children.length) return node
    return { ...node, sizes: normalizeSizes(sizes, node.children.length) }
  }
  if (node.type !== 'split') return node
  const [head, ...rest] = path
  return {
    ...node,
    children: node.children.map((c, i) => (i === head ? setSizesAt(c, rest, sizes) : c))
  }
}

/**
 * An even grid for any number of panes: 1, 2 and 3 in one row, 4 as 2×2,
 * more as two rows (8 → 4×2).
 */
export function autoGrid(ids: string[]): LayoutNode | null {
  const cells: LayoutNode[] = ids.map((paneId) => ({ type: 'pane', paneId }))
  if (cells.length === 0) return null
  if (cells.length === 1) return cells[0]!
  if (cells.length <= 3) return split('row', cells)
  const perRow = Math.ceil(cells.length / 2)
  const rows = [cells.slice(0, perRow), cells.slice(perRow)].map((r) =>
    r.length === 1 ? r[0]! : split('row', r)
  )
  return split('col', rows)
}

/** Stable key for a leaf, used for React keys and panel ids. */
export function leafKey(n: Exclude<LayoutNode, { type: 'split' }>): string {
  return n.type === 'pane' ? `p-${n.paneId}` : `e-${n.slotId}`
}

/** Changes whenever the tree's shape changes, but not when only sizes change. */
export function shapeKey(n: LayoutNode): string {
  if (isLeaf(n)) return leafKey(n)
  return `${n.dir}(${n.children.map(shapeKey).join(',')})`
}

/** True when the tree has the shape autoGrid would give its panes (sizes aside). */
export function isRegularGrid(node: LayoutNode | null): boolean {
  if (!node || emptySlotIds(node).length) return false
  const grid = autoGrid(paneIds(node))
  return !!grid && shapeKey(grid) === shapeKey(node)
}

/**
 * Where a new pane goes: the requested empty slot, else the first empty slot; a regular
 * grid is re-arranged to stay regular (so 8 panes end up 4×2); a custom tree splits the
 * target pane.
 */
export function placeNewPane(
  node: LayoutNode | null,
  paneId: string,
  opts: { slotId?: string | null; targetId?: string | null; dir?: SplitDir } = {}
): LayoutNode {
  const leaf: LayoutNode = { type: 'pane', paneId }
  if (!node) return leaf
  const slots = emptySlotIds(node)
  if (opts.slotId && slots.includes(opts.slotId)) return fillSlot(node, opts.slotId, paneId)
  if (slots[0]) return fillSlot(node, slots[0], paneId)
  const visible = paneIds(node)
  if (visible.length === 0) return leaf
  if (isRegularGrid(node)) return autoGrid([...visible, paneId])!
  const target =
    opts.targetId && visible.includes(opts.targetId) ? opts.targetId : visible[visible.length - 1]!
  return splitPane(node, target, paneId, opts.dir ?? 'row')
}
