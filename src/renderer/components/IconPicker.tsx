// Click a badge to give an account, workspace or folder an icon: search thousands of
// Material and Lucide icons, pick an emoji, or go back to the letter, and choose a tint.
// The popover is portaled to <body> because tables, dialogs and the sidebar clip it.
import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  EMOJI_MAX,
  ICON_SETS,
  ICON_SET_LABEL,
  glyphId,
  parseIcon,
  type IconSetName
} from '@shared/icons'
import { ACCOUNT_ICONS } from '@shared/types'
import { iconBody, searchIcons } from '../lib/icon-search'
import { useIconSets } from '../lib/icon-sets'
import { Avatar } from './AccountIcon'
import { IconSearch } from './icons'

export interface IconChoice {
  icon: string
  /** The tint; '' is neutral (not offered for accounts, which always have a color). */
  color: string
}

interface PickerProps {
  icon: string
  name: string
  color: string
  /** Tints to offer; omit for no color row. */
  colors?: readonly string[]
  size?: number
  onPick(choice: IconChoice): void
}

export function IconPicker({ icon, name, color, colors, size = 22, onPick }: PickerProps) {
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
        <Avatar icon={icon} name={name} color={color || 'var(--fa)'} size={size} />
      </button>
      {at ? (
        <IconPopover
          at={at}
          icon={icon}
          color={color}
          name={name}
          colors={colors}
          onPick={(choice, done) => {
            onPick(choice)
            if (done) close()
          }}
          onClose={close}
        />
      ) : null}
    </span>
  )
}

const POP_W = 360
const POP_H = 470

/** The picker on its own, for opening from somewhere other than the badge (a menu). */
export function IconPopover({
  at,
  icon,
  color,
  name,
  colors,
  onPick,
  onClose
}: {
  at: { top: number; left: number }
  icon: string
  color: string
  name: string
  colors?: readonly string[]
  /** `done`: an icon was chosen and the popover can close; a tint keeps it open. */
  onPick(choice: IconChoice, done: boolean): void
  onClose(): void
}) {
  const current = parseIcon(icon)
  const [tab, setTab] = useState<'icons' | 'emoji'>(current.kind === 'emoji' ? 'emoji' : 'icons')
  const [query, setQuery] = useState('')
  const [only, setOnly] = useState<IconSetName | null>(null)
  const [custom, setCustom] = useState('')
  // The tint shown in the preview and grid until the popover closes.
  const [tint, setTint] = useState(color)
  const sets = useIconSets()
  const hits = useMemo(
    () => (sets && tab === 'icons' ? searchIcons(sets, query, only) : []),
    [sets, tab, query, only]
  )
  const shownTint = tint || 'var(--fa)'
  const pickIcon = (next: string): void => onPick({ icon: next, color: tint }, true)

  return createPortal(
    <>
      <div className="icp-scrim" onClick={onClose} />
      <div
        className="icp-pop"
        role="dialog"
        aria-label={`Icon for ${name}`}
        style={{
          top: Math.max(8, Math.min(at.top, window.innerHeight - POP_H - 8)),
          left: Math.max(8, Math.min(at.left, window.innerWidth - POP_W - 8)),
          width: POP_W
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className="icp-hd">
          <Avatar icon={icon} name={name} color={shownTint} size={28} />
          <span className="icp-nm">{name}</span>
          <div className="seg" role="tablist" aria-label="Icon kind">
            {(['icons', 'emoji'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`seg-btn${tab === t ? ' on' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'icons' ? 'Icons' : 'Emoji'}
              </button>
            ))}
          </div>
        </div>

        {tab === 'icons' ? (
          <>
            <div className="icp-srch">
              <IconSearch small />
              <input
                value={query}
                placeholder="Search icons: rocket, code, cat…"
                aria-label="Search icons"
                spellCheck={false}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="icp-sets" role="radiogroup" aria-label="Icon set">
              {[null, ...ICON_SETS].map((s) => (
                <button
                  key={s ?? 'all'}
                  role="radio"
                  aria-checked={only === s}
                  className={`rchip${only === s ? ' on' : ''}`}
                  onClick={() => setOnly(s)}
                >
                  {s ? ICON_SET_LABEL[s] : 'All'}
                </button>
              ))}
            </div>
            <div className="icp-glyphs" role="listbox" aria-label="Icons">
              {!sets ? <div className="icp-empty">Loading icons…</div> : null}
              {sets && hits.length === 0 ? (
                <div className="icp-empty">No icon matches “{query}”.</div>
              ) : null}
              {sets
                ? hits.map((h) => {
                    const id = glyphId(h.set, h.name)
                    const body = iconBody(sets, h.set, h.name)
                    if (!body) return null
                    return (
                      <button
                        key={id}
                        role="option"
                        aria-selected={icon === id}
                        className={`icp-glyph${icon === id ? ' on' : ''}`}
                        aria-label={`Use ${ICON_SET_LABEL[h.set]} ${h.name.replace(/-/g, ' ')}`}
                        title={`${h.name.replace(/-/g, ' ')} · ${ICON_SET_LABEL[h.set]}`}
                        style={{ color: tint || undefined }}
                        onClick={() => pickIcon(id)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="20"
                          height="20"
                          aria-hidden="true"
                          dangerouslySetInnerHTML={{ __html: body }}
                        />
                      </button>
                    )
                  })
                : null}
            </div>
          </>
        ) : (
          <>
            <div className="icp-grid">
              {ACCOUNT_ICONS.map((ic) => (
                <button
                  key={ic}
                  className={`icp-opt${icon === ic ? ' on' : ''}`}
                  aria-label={`Use ${ic}`}
                  onClick={() => pickIcon(ic)}
                >
                  {ic}
                </button>
              ))}
            </div>
            <form
              className="icp-row"
              onSubmit={(e) => {
                e.preventDefault()
                if (custom.trim()) pickIcon(custom)
              }}
            >
              <input
                className="inpt sans"
                placeholder="Any emoji"
                aria-label="Custom icon"
                value={custom}
                maxLength={EMOJI_MAX}
                onChange={(e) => setCustom(e.target.value)}
                autoFocus
              />
              <button className="btn pri" type="submit" disabled={!custom.trim()}>
                Use
              </button>
            </form>
          </>
        )}

        <div className="icp-ft">
          {colors ? (
            <div className="icp-colors" role="radiogroup" aria-label="Icon color">
              {colors.map((c) => (
                <button
                  key={c || 'neutral'}
                  role="radio"
                  aria-checked={tint === c}
                  aria-label={c ? `Color ${c}` : 'Neutral color'}
                  title={c || 'Neutral'}
                  className={`icp-sw${tint === c ? ' on' : ''}${c ? '' : ' neutral'}`}
                  style={c ? { background: c } : undefined}
                  onClick={() => {
                    setTint(c)
                    onPick({ icon, color: c }, false)
                  }}
                />
              ))}
            </div>
          ) : (
            <span />
          )}
          <button
            className="btn gh"
            type="button"
            title="No icon: show the first letter"
            onClick={() => pickIcon('')}
          >
            Letter
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
