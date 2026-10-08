// A draggable panel edge (sidebar, Changes panel): resize live, save on release, double-click
// to reset. The dragged width lives in a CSS variable on the panel so the config isn't
// rewritten on every pointer move. It stays set after release (it equals the saved width):
// clearing it before React renders the saved width would snap the panel back and animate it
// forward again, moving the handle away from the pointer.
import { useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

interface Props {
  target: RefObject<HTMLElement | null>
  /** The CSS variable the panel's width reads while dragging, e.g. `--side-w`. */
  cssVar: string
  /** 'right' when the handle is the panel's right edge (sidebar), 'left' for a right panel. */
  edge: 'left' | 'right'
  min: number
  max: number
  label: string
  className?: string
  onCommit: (width: number) => void
  onReset: () => void
}

export function EdgeResizer({
  target,
  cssVar,
  edge,
  min,
  max,
  label,
  className = '',
  onCommit,
  onReset
}: Props) {
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = target.current
    if (e.button !== 0 || !el) return
    e.preventDefault()
    // Listen on window, not the handle: Chromium can drop the handle's pointer capture
    // mid-drag (seen under load), and later moves and the release must still arrive.
    e.currentTarget.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = el.getBoundingClientRect().width
    const sign = edge === 'right' ? 1 : -1
    const clamp = (w: number): number => Math.round(Math.min(max, Math.max(min, w)))
    let width = clamp(startW)
    setDragging(true)
    const move = (ev: PointerEvent): void => {
      width = clamp(startW + sign * (ev.clientX - startX))
      el.style.setProperty(cssVar, `${width}px`)
    }
    const end = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', end)
      setDragging(false)
      onCommit(width)
    }
    // The release point decides the saved width: a busy renderer can drop or coalesce the
    // last moves before the pointer is let go. A cancel keeps the last applied width.
    const up = (ev: PointerEvent): void => {
      move(ev)
      end()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', end)
  }

  return (
    <div
      className={`side-resize ${className}${dragging ? ' on' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        target.current?.style.removeProperty(cssVar)
        onReset()
      }}
    />
  )
}
