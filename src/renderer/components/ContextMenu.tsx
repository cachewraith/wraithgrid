// Right-click menu for sidebar rows. Portaled to <body>: the sidebar scrolls, clips, and
// its sections form stacking contexts while they fade in. Kept inside the window; closed by
// Escape, an outside click or a pick. Arrow keys move between items; Shift+F10 or the Menu
// key opens it from the keyboard.
import { Fragment, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconCheck } from './icons'

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  /** A second, quieter line under the label (an account's plan). */
  sub?: string
  /** Draws `sub` in the warning color ("Login needed"). */
  subWarn?: boolean
  /** A check at the end: the current choice. */
  checked?: boolean
  /** A small heading drawn above this item, starting a section. */
  heading?: string
  /** The item's shortcut, at the end. */
  kbd?: string
  /** A line drawn above this item. */
  divider?: boolean
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
  onClose,
  above = false,
  width,
  className
}: {
  at: MenuPoint
  label: string
  items: MenuItem[]
  onClose(): void
  /** Opens upwards: `at.y` is where the menu's bottom edge goes. */
  above?: boolean
  width?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(at)

  // Measure once and pull the menu back inside the window, then focus the first item.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const y = above ? at.y - r.height : at.y
    setPos({
      x: Math.max(EDGE, Math.min(at.x, window.innerWidth - r.width - EDGE)),
      y: Math.max(EDGE, Math.min(y, window.innerHeight - r.height - EDGE))
    })
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [at, above])

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
        className={`cm${above ? ' up' : ''}${className ? ` ${className}` : ''}`}
        role="menu"
        aria-label={label}
        style={{ left: pos.x, top: pos.y, width }}
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
          <Fragment
            // By position: a two-step item changes its label between clicks.
            key={i}
          >
            {it.divider ? <div className="cm-sep" role="separator" /> : null}
            {it.heading ? (
              <div className="cm-hd" aria-hidden="true">
                {it.heading}
              </div>
            ) : null}
            <button
              role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={it.checked}
              className={`cm-it${it.danger ? ' danger' : ''}${it.sub ? ' two' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                if (it.onSelect() !== false) onClose()
              }}
            >
              <span className="cm-ic" aria-hidden="true">
                {it.icon}
              </span>
              {it.sub ? (
                <span className="cm-tx">
                  <span className="cm-lb">{it.label}</span>
                  <span className={`cm-sub${it.subWarn ? ' warn' : ''}`}>{it.sub}</span>
                </span>
              ) : (
                it.label
              )}
              {it.kbd ? <kbd className="cm-kbd">{it.kbd}</kbd> : null}
              {it.checked ? <IconCheck small className="cm-ck" /> : null}
            </button>
          </Fragment>
        ))}
      </div>
    </>,
    document.body
  )
}
