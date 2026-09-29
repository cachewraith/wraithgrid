/**
 * Runs jobs no closer together than `gapMs`. Restored panes start one after another
 * (NFR-2: 150 ms apart) instead of all spawning in the same frame.
 */
export class StaggeredQueue {
  private nextAt = 0

  constructor(
    private readonly gapMs: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  push(job: () => void): void {
    const now = this.now()
    const at = Math.max(now, this.nextAt)
    this.nextAt = at + this.gapMs
    if (at === now) job()
    else setTimeout(job, at - now)
  }
}

/** Latest measured rectangle of each visible pane, for focus navigation and split direction. */
export class RectRegistry {
  private rects: Record<string, { left: number; top: number; width: number; height: number }> = {}

  set(rects: RectRegistry['rects']): void {
    this.rects = rects
  }

  all(): RectRegistry['rects'] {
    return this.rects
  }

  get(id: string): RectRegistry['rects'][string] | undefined {
    return this.rects[id]
  }
}
