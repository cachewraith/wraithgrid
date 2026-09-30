// Click a badge to pick an emoji for it, type any emoji, or go back to the letter.
// The popover is fixed-positioned because tables and dialogs clip overflowing children.
import { useRef, useState } from 'react'
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
  const [custom, setCustom] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  // Focus goes back to the badge so keys (Esc in a dialog) keep working after a pick.
  const close = (): void => {
    setAt(null)
    setCustom('')
    btnRef.current?.focus()
  }
  const pick = (next: string): void => {
    onPick(next)
    close()
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
          setAt({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 280) })
        }}
      >
        <Avatar icon={icon} name={name} color={color} size={size} />
      </button>
      {at ? <div className="icp-scrim" onClick={close} /> : null}
      {at ? (
        <div
          className="icp-pop"
          role="dialog"
          aria-label={`Icon for ${name}`}
          style={{ top: at.top, left: at.left }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') close()
          }}
        >
          <div className="icp-grid">
            {ACCOUNT_ICONS.map((ic) => (
              <button
                key={ic}
                className={`icp-opt${icon === ic ? ' on' : ''}`}
                aria-label={`Use ${ic}`}
                onClick={() => pick(ic)}
              >
                {ic}
              </button>
            ))}
          </div>
          <form
            className="icp-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (custom.trim()) pick(custom)
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
              onClick={() => pick('')}
            >
              Letter
            </button>
          </form>
        </div>
      ) : null}
    </span>
  )
}
