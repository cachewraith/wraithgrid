// The controls under the chat box, like Claude Code's: model, effort and permission mode.
// Each is a chip that opens a short list above it (portaled: the pane clips and is a
// container). Lists come from the CLI itself; nothing here is hard-coded per model.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  CHAT_EFFORTS,
  CHAT_MODE_HINT,
  CHAT_MODE_LABEL,
  CHAT_MODES,
  EFFORT_LABEL,
  type ChatEffort,
  type ChatMode,
  type ChatModel
} from '@shared/chat'
import { IconCheck, IconChevron } from '../icons'

/** A chip that opens a list above it; Esc or a click outside closes it. */
function ChipMenu({
  label,
  ariaLabel,
  popLabel,
  className = '',
  openSignal = 0,
  width = 320,
  children
}: {
  label: ReactNode
  ariaLabel: string
  popLabel: string
  className?: string
  /** Opens the list whenever it changes (a `/` command). */
  openSignal?: number
  width?: number
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [seenSignal, setSeenSignal] = useState(openSignal)
  if (openSignal !== seenSignal) {
    setSeenSignal(openSignal)
    setOpen(true)
  }
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      bottom: window.innerHeight - r.top + 6
    })
  }, [open, width])

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
        className={`mp-btn ${className}${open ? ' open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen(!open)}
      >
        {label}
        <IconChevron small className="mp-chev" />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popRef}
              className="mp-pop"
              role="dialog"
              aria-label={popLabel}
              style={{ left: pos.left, bottom: pos.bottom, width }}
            >
              {children(() => setOpen(false))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

function Option({
  on,
  name,
  hint,
  tone,
  disabled,
  onPick
}: {
  on: boolean
  name: string
  hint?: string
  tone?: string
  disabled?: boolean
  onPick: () => void
}) {
  return (
    <button
      role="option"
      aria-selected={on}
      className={`mp-opt${on ? ' on' : ''}${tone ? ` ${tone}` : ''}`}
      disabled={disabled}
      onClick={onPick}
    >
      <span className="mp-txt">
        <span className="mp-nm">{name}</span>
        {hint ? <span className="mp-ds">{hint}</span> : null}
      </span>
      {on ? <IconCheck small /> : null}
    </button>
  )
}

export function ModelPicker({
  models,
  model,
  running,
  openSignal,
  onModel
}: {
  /** What the CLI offered; empty until the chat's process said. */
  models: ChatModel[]
  /** The pane's pick; null: the CLI's default. */
  model: string | null
  /** The model the CLI reported running, shown until the list arrives. */
  running: string | null
  openSignal?: number
  onModel: (model: string | null) => void
}) {
  // `default` is the CLI's own "Default (recommended)" entry; picking it clears the choice.
  const chosen = models.find((m) => m.value === (model ?? 'default'))
  const label =
    chosen?.value === 'default'
      ? (chosen.description.split('·')[0]?.trim() ?? 'Default')
      : (chosen?.label ?? model ?? running ?? 'Model')
  return (
    <ChipMenu
      label={<span>{label}</span>}
      ariaLabel={`Model: ${label}. Change`}
      popLabel="Model"
      openSignal={openSignal}
    >
      {(close) =>
        models.length === 0 ? (
          <div className="mp-empty">The model list appears once the chat has started.</div>
        ) : (
          <div className="mp-list" role="listbox" aria-label="Models">
            {models.map((m) => (
              <Option
                key={m.value}
                on={m.value === (model ?? 'default')}
                name={m.label}
                hint={m.description}
                onPick={() => {
                  onModel(m.value === 'default' ? null : m.value)
                  close()
                }}
              />
            ))}
          </div>
        )
      }
    </ChipMenu>
  )
}

const EFFORT_HINT: Record<ChatEffort, string> = {
  low: 'Quickest answers, least thinking',
  medium: 'Balanced',
  high: 'Thinks longer on hard problems',
  xhigh: 'Even longer',
  max: 'As long as it takes'
}

export function EffortPicker({
  efforts,
  effort,
  busy,
  openSignal,
  onEffort
}: {
  /** What the chosen model takes (the CLI says); empty: no picker. */
  efforts: string[]
  effort: ChatEffort | null
  /** Effort restarts the process: not while a turn runs. */
  busy: boolean
  openSignal?: number
  onEffort: (effort: ChatEffort | null) => void
}) {
  const levels = efforts.filter((e): e is ChatEffort =>
    (CHAT_EFFORTS as readonly string[]).includes(e)
  )
  if (!levels.length) return null
  const label = effort ? EFFORT_LABEL[effort] : 'Auto effort'
  return (
    <ChipMenu
      label={<span>{label}</span>}
      ariaLabel={`Effort: ${label}. Change`}
      popLabel="Effort"
      openSignal={openSignal}
      width={280}
    >
      {(close) => (
        <>
          <div className="mp-list" role="listbox" aria-label="Effort">
            {([null, ...levels] as (ChatEffort | null)[]).map((e) => (
              <Option
                key={e ?? 'auto'}
                on={effort === e}
                name={e === null ? 'Auto' : EFFORT_LABEL[e]}
                hint={e === null ? "The model's own default" : EFFORT_HINT[e]}
                disabled={busy}
                onPick={() => {
                  onEffort(e)
                  close()
                }}
              />
            ))}
          </div>
          <p className="mp-foot">
            {busy ? 'Can change after this turn.' : 'Changing it restarts the chat; it carries on.'}
          </p>
        </>
      )}
    </ChipMenu>
  )
}

export function ModePicker({
  mode,
  autoMode,
  modes,
  asks = true,
  openSignal,
  onMode
}: {
  mode: ChatMode
  /** The model can run in auto mode. */
  autoMode: boolean
  /** The modes the CLI has, when not all of them (agy). */
  modes?: ChatMode[]
  /** It asks before a tool; else "ask" modes refuse instead. */
  asks?: boolean
  openSignal?: number
  onMode: (mode: ChatMode) => void
}) {
  return (
    <ChipMenu
      label={
        <>
          <span className={`mp-dot mode-${mode}`} aria-hidden="true" />
          <span>{CHAT_MODE_LABEL[mode]}</span>
        </>
      }
      ariaLabel={`Mode: ${CHAT_MODE_LABEL[mode]}. Change (Shift+Tab)`}
      popLabel="Mode"
      className={`mode-chip mode-${mode}`}
      openSignal={openSignal}
    >
      {(close) => (
        <ModeList
          mode={mode}
          autoMode={autoMode}
          modes={modes}
          asks={asks}
          onMode={onMode}
          close={close}
        />
      )}
    </ChipMenu>
  )
}

/** Mounted only while the menu is open, so the bypass confirm never outlives it. */
/** Hints for a CLI that can't ask in a chat: what would ask is refused instead. */
const NO_ASK_HINT: Partial<Record<ChatMode, string>> = {
  default: "Refuses edits and commands that need approval (it can't ask here)",
  acceptEdits: 'Edits files on its own; refuses commands that need approval'
}

function ModeList({
  mode,
  autoMode,
  modes: only,
  asks,
  onMode,
  close
}: {
  mode: ChatMode
  autoMode: boolean
  modes?: ChatMode[]
  asks: boolean
  onMode: (mode: ChatMode) => void
  close: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const modes = CHAT_MODES.filter(
    (m) => (!only || only.includes(m)) && (m !== 'auto' || autoMode || mode === 'auto')
  )
  const cycle = modes.filter((m) => m !== 'dontAsk' && m !== 'bypassPermissions').length
  return (
    <>
      <div className="mp-list" role="listbox" aria-label="Modes">
        {modes.map((m) => {
          const asking = m === 'bypassPermissions' && confirm && mode !== m
          return (
            <Option
              key={m}
              on={mode === m}
              name={asking ? 'Click again to bypass permissions' : CHAT_MODE_LABEL[m]}
              hint={(!asks && NO_ASK_HINT[m]) || CHAT_MODE_HINT[m]}
              tone={m === 'bypassPermissions' ? 'danger' : undefined}
              onPick={() => {
                // Running everything unasked takes a second click.
                if (m === 'bypassPermissions' && mode !== m && !confirm) {
                  setConfirm(true)
                  return
                }
                onMode(m)
                close()
              }}
            />
          )
        })}
      </div>
      <p className="mp-foot">
        Shift+Tab switches between the first {['', 'one', 'two', 'three', 'four'][cycle] ?? cycle}.
      </p>
    </>
  )
}

export interface AccountChoice {
  id: string
  name: string
  plan: string | null
  /** Current-session limit used, in %, when claude has reported one. */
  sessionPct: number | null
  signedIn: boolean
}

/** "Continue as…": carries the chat on as another account of its CLI (#29, #60). */
export function AccountPicker({
  current,
  accounts,
  busy,
  onPick,
  onSignIn
}: {
  current: AccountChoice
  accounts: AccountChoice[]
  busy: boolean
  onPick: (id: string) => void
  onSignIn: (id: string) => void
}) {
  const hint = (a: AccountChoice): string =>
    a.signedIn
      ? [a.plan, a.sessionPct !== null ? `${a.sessionPct}% of session used` : null]
          .filter(Boolean)
          .join(' · ') || 'Signed in'
      : 'Not signed in · sign in first'
  return (
    <ChipMenu
      label={<span>{current.name}</span>}
      ariaLabel={`Account: ${current.name}. Continue as another account`}
      popLabel="Continue as"
      className="mp-acct"
    >
      {(close) => (
        <div className="mp-list" role="listbox" aria-label="Accounts">
          <div className="mp-hd">Continue as…</div>
          {busy ? (
            <div className="mp-empty">Wait for the answer to finish, or stop it first.</div>
          ) : null}
          {accounts.map((a) => (
            <Option
              key={a.id}
              on={a.id === current.id}
              name={a.name}
              hint={hint(a)}
              disabled={busy && a.id !== current.id}
              onPick={() => {
                close()
                if (a.id === current.id) return
                if (a.signedIn) onPick(a.id)
                else onSignIn(a.id)
              }}
            />
          ))}
        </div>
      )}
    </ChipMenu>
  )
}
