// Click a badge to pick an emoji for it, type any emoji, or go back to the letter.
// The popover is portaled to <body> because tables, dialogs and the sidebar clip it.
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ACCOUNT_ICON_MAX, ACCOUNT_ICONS } from '@shared/types'
import { Avatar } from './AccountIcon'

interface Props {
  icon: string
  name: string
  color: string
  size?: number
  onPick(icon: string): void
}

export function IconPicker({ icon, name, color, size = 22, onPick }: Props) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Focus goes back to the badge so keys (Esc in a dialog) keep working after a pick.
  const close = (): void => {
    setAt(null)
    btnRef.current?.focus()
  }

  return (
    <span className="icp">
      <button
        ref={btnRef}
        className="icp-btn"
        aria-label={`Change the icon of ${name}`}
        aria-expanded={at !== null}
        title="Change icon"
        onClick={(e) => {
          e.stopPropagation()
          if (at) return close()
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ top: r.bottom + 6, left: r.left })
        }}
      >
        <Avatar icon={icon} name={name} color={color} size={size} />
      </button>
      {at ? (
        <IconPopover
          at={at}
          icon={icon}
          name={name}
          onPick={(next) => {
            onPick(next)
            close()
          }}
          onClose={close}
        />
      ) : null}
    </span>
  )
}

/** The emoji grid on its own, for opening from somewhere other than the badge (a menu). */
export function IconPopover({
  at,
  icon,
  name,
  onPick,
  onClose
}: {
  at: { top: number; left: number }
  icon: string
  name: string
  onPick(icon: string): void
  onClose(): void
}) {
  const [custom, setCustom] = useState('')
  return createPortal(
    <>
      <div className="icp-scrim" onClick={onClose} />
      <div
        className="icp-pop"
        role="dialog"
        aria-label={`Icon for ${name}`}
        style={{ top: at.top, left: Math.min(at.left, window.innerWidth - 280) }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className="icp-grid">
          {ACCOUNT_ICONS.map((ic) => (
            <button
              key={ic}
              className={`icp-opt${icon === ic ? ' on' : ''}`}
              aria-label={`Use ${ic}`}
              onClick={() => onPick(ic)}
            >
              {ic}
            </button>
          ))}
        </div>
        <form
          className="icp-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (custom.trim()) onPick(custom)
          }}
        >
          <input
            className="inpt sans"
            placeholder="Any emoji"
            aria-label="Custom icon"
            value={custom}
            maxLength={ACCOUNT_ICON_MAX}
            onChange={(e) => setCustom(e.target.value)}
            autoFocus
          />
          <button className="btn pri" type="submit" disabled={!custom.trim()}>
            Use
          </button>
          <button
            className="btn gh"
            type="button"
            title="No emoji: show the first letter"
            onClick={() => onPick('')}
          >
            Letter
          </button>
        </form>
      </div>
    </>,
    document.body
  )
}
