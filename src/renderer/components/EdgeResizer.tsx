// A draggable panel edge (sidebar, Changes panel): resize live, save on release, double-click
// to reset. While dragging, the width lives in a CSS variable on the panel so the config
// isn't rewritten on every pointer move.
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
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
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
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      setDragging(false)
      el.style.removeProperty(cssVar)
      onCommit(width)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  return (
    <div
      className={`side-resize ${className}${dragging ? ' on' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
    />
  )
}
