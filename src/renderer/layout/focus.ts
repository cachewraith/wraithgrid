export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export type Direction = 'left' | 'right' | 'up' | 'down'

const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/**
 * The nearest pane in a direction, judged by rectangles: candidates must lie beyond the
 * current pane's edge; panes that share the perpendicular span win over diagonal ones.
 */
export function neighborInDirection(
  rects: Record<string, Rect>,
  fromId: string,
  dir: Direction
): string | null {
  const from = rects[fromId]
  if (!from) return null
  const fr = { l: from.left, t: from.top, r: from.left + from.width, b: from.top + from.height }
  const fcx = fr.l + from.width / 2
  const fcy = fr.t + from.height / 2
  const EPS = 2

  let best: { id: string; score: number } | null = null
  for (const [id, rect] of Object.entries(rects)) {
    if (id === fromId) continue
    const r = { l: rect.left, t: rect.top, r: rect.left + rect.width, b: rect.top + rect.height }
    const cx = r.l + rect.width / 2
    const cy = r.t + rect.height / 2

    let gap: number
    let shared: number
    let offAxis: number
    if (dir === 'right') {
      if (r.l < fr.r - EPS) continue
      gap = r.l - fr.r
      shared = overlap(fr.t, fr.b, r.t, r.b)
      offAxis = Math.abs(cy - fcy)
    } else if (dir === 'left') {
      if (r.r > fr.l + EPS) continue
      gap = fr.l - r.r
      shared = overlap(fr.t, fr.b, r.t, r.b)
      offAxis = Math.abs(cy - fcy)
    } else if (dir === 'down') {
      if (r.t < fr.b - EPS) continue
      gap = r.t - fr.b
      shared = overlap(fr.l, fr.r, r.l, r.r)
      offAxis = Math.abs(cx - fcx)
    } else {
      if (r.b > fr.t + EPS) continue
      gap = fr.t - r.b
      shared = overlap(fr.l, fr.r, r.l, r.r)
      offAxis = Math.abs(cx - fcx)
    }
    const score = (shared > 0 ? 0 : 1_000_000) + gap * 1000 + offAxis
    if (!best || score < best.score) best = { id, score }
  }
  return best?.id ?? null
}
