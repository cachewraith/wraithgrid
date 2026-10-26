// A panel edge being dragged (sidebar, Changes panel; #126). Work that only needs the final
// size (a terminal's pty resize, which makes a TUI redraw its whole screen) or that competes
// with the drag for each frame (the paced text reveal) waits for the release.
let active = false
const ends = new Set<() => void>()

export function panelDragging(): boolean {
  return active
}

/** Set by EdgeResizer on press and release; a release runs the waiting work once. */
export function setPanelDragging(on: boolean): void {
  if (active === on) return
  active = on
  if (!on) for (const f of [...ends]) f()
}

/** Calls `f` each time a drag ends; returns the unsubscribe. */
export function onPanelDragEnd(f: () => void): () => void {
  ends.add(f)
  return () => {
    ends.delete(f)
  }
}
