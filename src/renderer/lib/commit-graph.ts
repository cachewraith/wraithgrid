// Lanes for the Changes panel's history graph: each commit gets a column, and each row says
// which lines cross its top half (from the row above into this commit, or straight through)
// and its bottom half (from this commit to its parents' lanes, or straight through). Pure, so
// a page of commits lays out the same every time.

export interface GraphCommit {
  sha: string
  parents: string[]
}

/** A line inside one half of a row, from column `from` (top) to column `to` (bottom). */
export interface Edge {
  from: number
  to: number
  /** Lane color index. */
  color: number
}

export interface GraphRow {
  col: number
  color: number
  top: Edge[]
  bottom: Edge[]
  /** Columns in use on this row, for the graph's width. */
  width: number
}

interface Lane {
  sha: string
  color: number
}

export function layoutGraph(commits: GraphCommit[]): GraphRow[] {
  const lanes: (Lane | null)[] = []
  let nextColor = 0
  const free = (): number => {
    const i = lanes.indexOf(null)
    return i === -1 ? lanes.length : i
  }
  return commits.map((c) => {
    // Top half: lanes waiting for this commit run into it (the first one is its column);
    // every other lane goes straight through.
    let col = lanes.findIndex((l) => l?.sha === c.sha)
    const tip = col === -1
    const top: Edge[] = []
    lanes.forEach((l, i) => {
      if (!l) return
      if (l.sha === c.sha) {
        top.push({ from: i, to: col, color: l.color })
        if (i !== col) lanes[i] = null
      } else top.push({ from: i, to: i, color: l.color })
    })
    // A branch tip nobody above points at starts at its node, in the first free column.
    if (tip) col = free()
    const color = tip ? nextColor++ : lanes[col]!.color
    lanes[col] = null

    // Bottom half: to the first parent (in this lane, or into the lane that already waits for
    // it), to every other parent (a merge), and straight through for the rest.
    const bottom: Edge[] = []
    const created = new Set<number>()
    const [first, ...rest] = c.parents
    if (first) {
      const at = lanes.findIndex((l) => l?.sha === first)
      if (at !== -1 && at < col) bottom.push({ from: col, to: at, color: lanes[at]!.color })
      else if (at > col) {
        // The lane to the right joins this one, so the main line stays in the leftmost column.
        bottom.push({ from: at, to: col, color: lanes[at]!.color })
        lanes[at] = null
        lanes[col] = { sha: first, color }
        created.add(col)
        bottom.push({ from: col, to: col, color })
      } else {
        lanes[col] = { sha: first, color }
        created.add(col)
        bottom.push({ from: col, to: col, color })
      }
    }
    for (const p of rest) {
      let at = lanes.findIndex((l) => l?.sha === p)
      if (at === -1) {
        at = free()
        lanes[at] = { sha: p, color: nextColor++ }
        created.add(at)
      }
      bottom.push({ from: col, to: at, color: lanes[at]!.color })
    }
    lanes.forEach((l, i) => {
      if (l && !created.has(i)) bottom.push({ from: i, to: i, color: l.color })
    })
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    const cols = [col, ...top, ...bottom].flatMap((e) =>
      typeof e === 'number' ? [e] : [e.from, e.to]
    )
    return { col, color, top, bottom, width: Math.max(...cols) + 1 }
  })
}

/** Labels from git's decoration: `HEAD -> main`, `origin/main`, `tag: v1.2.0`. */
export function refLabels(
  refs: string[]
): { text: string; kind: 'head' | 'branch' | 'remote' | 'tag' }[] {
  return refs.map((r) => {
    if (r.startsWith('HEAD -> ')) return { text: r.slice(8), kind: 'head' as const }
    if (r.startsWith('tag: ')) return { text: r.slice(5), kind: 'tag' as const }
    return { text: r, kind: r.includes('/') ? ('remote' as const) : ('branch' as const) }
  })
}
