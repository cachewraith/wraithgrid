// Right-click menu for sidebar rows. Portaled to <body>: the sidebar scrolls, clips, and
// its sections form stacking contexts while they fade in. Kept inside the window; closed by
// Escape, an outside click or a pick. Arrow keys move between items; Shift+F10 or the Menu
// key opens it from the keyboard.
import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  /** Return false to keep the menu open (a two-step delete). */
  onSelect(): void | false
}

export interface MenuPoint {
  x: number
  y: number
}

/** Where a menu opens: at the pointer, or under the row when the keyboard opened it. */
export function menuPoint(e: MouseEvent<HTMLElement>): MenuPoint {
  if (e.clientX === 0 && e.clientY === 0) {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: r.left + 12, y: r.bottom }
  }
  return { x: e.clientX, y: e.clientY }
}

const EDGE = 4

export function ContextMenu({
  at,
  label,
  items,
  onClose
}: {
  at: MenuPoint
  label: string
  items: MenuItem[]
  onClose(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(at)

  // Measure once and pull the menu back inside the window, then focus the first item.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.max(EDGE, Math.min(at.x, window.innerWidth - width - EDGE)),
      y: Math.max(EDGE, Math.min(at.y, window.innerHeight - height - EDGE))
    })
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [at])

  const move = (step: 1 | -1): void => {
    const buttons = [...(ref.current?.querySelectorAll('button:not(:disabled)') ?? [])]
    if (!buttons.length) return
    const i = buttons.indexOf(document.activeElement as Element)
    ;(buttons[(i + step + buttons.length) % buttons.length] as HTMLButtonElement).focus()
  }

  return createPortal(
    <>
      <div
        className="cm-scrim"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={ref}
        className="cm"
        role="menu"
        aria-label={label}
        style={{ left: pos.x, top: pos.y }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            move(1)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            move(-1)
          }
        }}
      >
        {items.map((it, i) => (
          <button
            // By position: a two-step item changes its label between clicks.
            key={i}
            role="menuitem"
            className={`cm-it${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              if (it.onSelect() !== false) onClose()
            }}
          >
            <span className="cm-ic" aria-hidden="true">
              {it.icon}
            </span>
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body
  )
}
