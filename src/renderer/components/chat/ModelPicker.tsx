import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CHAT_EFFORTS, EFFORT_LABEL, type ChatEffort, type ChatModel } from '@shared/chat'
import { IconCheck, IconChevron } from '../icons'

interface Props {
  /** What the CLI offered; empty until the chat's process said. */
  models: ChatModel[]
  /** The pane's pick; null: the CLI's default. */
  model: string | null
  effort: ChatEffort | null
  /** The model the CLI reported running, shown until the list arrives. */
  running: string | null
  /** Effort restarts the process: not while a turn runs. */
  busy: boolean
  onModel: (model: string | null) => void
  onEffort: (effort: ChatEffort | null) => void
}

/** "Opus 5.5 ⌄" in the message box, like Claude's: switch the model, set the effort. */
export function ModelPicker({ models, model, effort, running, busy, onModel, onEffort }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // `default` is the CLI's own "Default (recommended)" entry; picking it clears the choice.
  const chosen = models.find((m) => m.value === (model ?? 'default'))
  const label =
    chosen?.value === 'default'
      ? (chosen.description.split('·')[0]?.trim() ?? 'Default')
      : (chosen?.label ?? model ?? running ?? 'Model')
  const efforts = ((chosen ?? models[0])?.efforts ?? []).filter((e): e is ChatEffort =>
    (CHAT_EFFORTS as readonly string[]).includes(e)
  )

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 328)),
      bottom: window.innerHeight - r.top + 6
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        className={`mp-btn${open ? ' open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Model: ${label}${effort ? `, ${EFFORT_LABEL[effort]} effort` : ''}. Change`}
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        {effort ? <span className="mp-eff">{EFFORT_LABEL[effort]}</span> : null}
        <IconChevron small className="mp-chev" />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popRef}
              className="mp-pop"
              role="dialog"
              aria-label="Model"
              style={{ left: pos.left, bottom: pos.bottom }}
            >
              {models.length === 0 ? (
                <div className="mp-empty">The model list appears once the chat has started.</div>
              ) : (
                <div className="mp-list" role="listbox" aria-label="Models">
                  {models.map((m) => {
                    const on = m.value === (model ?? 'default')
                    return (
                      <button
                        key={m.value}
                        role="option"
                        aria-selected={on}
                        className={`mp-opt${on ? ' on' : ''}`}
                        onClick={() => {
                          onModel(m.value === 'default' ? null : m.value)
                          setOpen(false)
                        }}
                      >
                        <span className="mp-txt">
                          <span className="mp-nm">{m.label}</span>
                          {m.description ? <span className="mp-ds">{m.description}</span> : null}
                        </span>
                        {on ? <IconCheck small /> : null}
                      </button>
                    )
                  })}
                </div>
              )}
              {efforts.length ? (
                <div className="mp-eff-row">
                  <span className="mp-eff-h" id="mp-eff-h">
                    Effort
                  </span>
                  <div className="seg" role="radiogroup" aria-labelledby="mp-eff-h">
                    {([null, ...efforts] as (ChatEffort | null)[]).map((e) => (
                      <button
                        key={e ?? 'default'}
                        role="radio"
                        aria-checked={effort === e}
                        className={`seg-btn${effort === e ? ' on' : ''}`}
                        disabled={busy}
                        title={busy ? 'After this turn' : 'Restarts the chat; it carries on'}
                        onClick={() => onEffort(e)}
                      >
                        {e === null ? 'Auto' : EFFORT_LABEL[e]}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
