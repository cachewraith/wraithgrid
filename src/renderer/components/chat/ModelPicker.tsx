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
import { AGENT_CLI_SPECS, AGENT_PROVIDER_LABEL, type AgentCli } from '@shared/agent-clis'
import { ProviderLogo } from '../ProviderLogo'
import { modelTabs, tabOf, type ModelTab } from '../../lib/model-groups'

/** A chip that opens a list above it; Esc or a click outside closes it. */
function ChipMenu({
  label,
  ariaLabel,
  popLabel,
  className = '',
  openSignal = 0,
  width = 320,
  height,
  children
}: {
  label: ReactNode
  ariaLabel: string
  popLabel: string
  className?: string
  /** Opens the list whenever it changes (a `/` command). */
  openSignal?: number
  width?: number
  /** A fixed height (the account list, #160): tabs switching inside never resize it. */
  height?: number
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [seenSignal, setSeenSignal] = useState(openSignal)
  if (openSignal !== seenSignal) {
    setSeenSignal(openSignal)
    setOpen(true)
  }
  const [pos, setPos] = useState<{ left: number; bottom: number; room: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // Above the chip, never past the window's top (#160): the list scrolls inside instead.
  // Again on resize, which a zoom (Ctrl+=) also is.
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const btn = btnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - r.top + 6,
        room: Math.max(120, r.top - 6 - 8)
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
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
              style={{
                left: pos.left,
                bottom: pos.bottom,
                width,
                maxHeight: pos.room,
                height: height ? Math.min(height, pos.room) : undefined
              }}
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
  const tabs = modelTabs(models)
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
      width={tabs ? 440 : 320}
    >
      {(close) =>
        models.length === 0 ? (
          <div className="mp-empty">The model list appears once the chat has started.</div>
        ) : tabs ? (
          <ModelTabs
            tabs={tabs}
            value={model ?? 'default'}
            onPick={(v) => {
              onModel(v === 'default' ? null : v)
              close()
            }}
          />
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

/** A long model list as Latest + one tab per family (#160). */
function ModelTabs({
  tabs,
  value,
  onPick
}: {
  tabs: ModelTab[]
  value: string
  onPick: (value: string) => void
}) {
  const [tab, setTab] = useState(() => tabOf(tabs, value))
  const list = (tabs.find((t) => t.id === tab) ?? tabs[0]!).models
  return (
    <div className="account-body">
      <div
        className="account-rail"
        role="tablist"
        aria-label="Model families"
        aria-orientation="vertical"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === tab}
            className={`account-tab${t.id === tab ? ' on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="account-tab-lab">
              <span className="account-tab-nm">{t.label}</span>
              <span className="account-tab-n mono">{t.models.length}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mp-list" role="listbox" aria-label="Models">
        {list.map((m) => (
          <Option
            key={m.value}
            on={m.value === value}
            name={m.label}
            hint={m.description}
            onPick={() => onPick(m.value)}
          />
        ))}
      </div>
    </div>
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
              name={asking ? 'Click again for full access' : CHAT_MODE_LABEL[m]}
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
  cli: AgentCli
  id: string
  name: string
  plan: string | null
  /** Five-hour limit used, in %, when the provider has reported one. */
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
  return (
    <ChipMenu
      label={
        <>
          <ProviderLogo cli={current.cli} fallbackName={current.name} />
          <span className="mp-account-name">{current.name}</span>
        </>
      }
      ariaLabel={`Account: ${current.name}. Continue as another account`}
      popLabel="Continue as"
      className="mp-acct"
      // The provider rail needs room only when there is more than one provider.
      width={new Set([current.cli, ...accounts.map((a) => a.cli)]).size > 1 ? 460 : 360}
      height={400}
    >
      {(close) => <AccountList {...{ current, accounts, busy, onPick, onSignIn, close }} />}
    </ChipMenu>
  )
}

/** What switching to an account of `cli` does, from a chat of `from`. */
function switchHint(cli: AgentCli, from: AgentCli, short: boolean): string {
  if (cli === from) return short ? 'same chat' : 'continue · same chat'
  if (AGENT_CLI_SPECS[cli].chat) return short ? 'new chat' : 'new chat · handoff'
  return short ? 'terminal' : 'terminal · no handoff'
}

const ORDER: AgentCli[] = ['claude', 'codex', 'agy', 'gemini', 'cursor', 'copilot', 'opencode']

/**
 * The accounts as one provider at a time (#160): a rail of providers on the left, the chosen
 * one's accounts on the right, current first. Typing searches every provider, grouped.
 */
function AccountList({
  current,
  accounts,
  busy,
  onPick,
  onSignIn,
  close
}: {
  current: AccountChoice
  accounts: AccountChoice[]
  busy: boolean
  onPick: (id: string) => void
  onSignIn: (id: string) => void
  close: () => void
}) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<AgentCli>(current.cli)
  const [active, setActive] = useState(0)
  const keyboardScroll = useRef(true)
  const listRef = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()
  const matches = (a: AccountChoice): boolean =>
    `${a.name} ${a.plan ?? ''} ${AGENT_PROVIDER_LABEL[a.cli]}`.toLowerCase().includes(q)
  const ofCli = (cli: AgentCli): AccountChoice[] => accounts.filter((a) => a.cli === cli)
  const tabs = ORDER.filter((cli) => cli === current.cli || ofCli(cli).length > 0)
  // The list shown: every provider's matches while searching, else the tab's, current first.
  const shown = q
    ? tabs.flatMap((cli) => ofCli(cli).filter(matches))
    : ofCli(tab).sort((a, b) => Number(b.id === current.id) - Number(a.id === current.id))
  const pick = (a: AccountChoice): void => {
    if (busy && a.id !== current.id) return
    close()
    if (a.id === current.id) return
    if (a.signedIn) onPick(a.id)
    else onSignIn(a.id)
  }
  const openTab = (cli: AgentCli): void => {
    keyboardScroll.current = true
    setTab(cli)
    setQuery('')
    setActive(0)
  }
  useEffect(() => {
    if (!keyboardScroll.current) return
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, [active, query, tab])

  const row = (a: AccountChoice) => {
    const sub = !a.signedIn ? 'Not signed in' : a.plan && a.plan !== 'Signed in' ? a.plan : null
    const pct = a.sessionPct
    return (
      <button
        key={a.id}
        id={`account-option-${a.id}`}
        role="option"
        aria-selected={a.id === current.id}
        data-active={shown[active]?.id === a.id}
        className={`account-option${a.id === current.id ? ' current' : ''}${!a.signedIn ? ' unsigned' : ''}`}
        disabled={busy && a.id !== current.id}
        onMouseMove={() => {
          keyboardScroll.current = false
          setActive(shown.indexOf(a))
        }}
        onClick={() => pick(a)}
      >
        <ProviderLogo cli={a.cli} fallbackName={a.name} />
        <span className="account-line">
          <span className="mp-nm">{a.name}</span>
          {sub ? <span className="mp-ds">{sub}</span> : null}
        </span>
        {!a.signedIn ? (
          <span className="account-use mono">Sign in</span>
        ) : pct === null ? (
          <span className="account-use mono">—</span>
        ) : (
          <span
            className={`account-bar${pct >= 80 ? ' hot' : ''}`}
            title={`${pct}% of the 5-hour limit`}
          >
            <i style={{ width: `${Math.min(100, pct)}%` }} />
            <span className="sr-only">{pct}%</span>
          </span>
        )}
        {a.id === current.id ? <IconCheck small /> : <span />}
      </button>
    )
  }

  return (
    <>
      <input
        autoFocus
        className="mp-search"
        aria-label="Search accounts"
        placeholder="Search accounts"
        role="combobox"
        aria-expanded="true"
        aria-controls={`accounts-${current.id}`}
        aria-activedescendant={shown[active] ? `account-option-${shown[active]!.id}` : undefined}
        value={query}
        onChange={(e) => {
          keyboardScroll.current = true
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            keyboardScroll.current = true
            setActive(
              (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % (shown.length || 1)
            )
          } else if (e.key === 'Enter' && shown[active]) {
            e.preventDefault()
            pick(shown[active]!)
          } else if (e.key === 'Tab' && !q && tabs.length > 1) {
            // Tab / Shift+Tab: the next or previous provider.
            e.preventDefault()
            const i = tabs.indexOf(tab) + (e.shiftKey ? -1 : 1)
            openTab(tabs[(i + tabs.length) % tabs.length]!)
          }
        }}
      />
      {busy ? (
        <div className="mp-empty">Wait for the answer to finish, or stop it first.</div>
      ) : null}
      <div className="account-body">
        {tabs.length > 1 ? (
          <div
            className="account-rail"
            role="tablist"
            aria-label="Providers"
            aria-orientation="vertical"
          >
            {tabs.map((cli) => {
              const n = q ? ofCli(cli).filter(matches).length : ofCli(cli).length
              return (
                <button
                  key={cli}
                  role="tab"
                  tabIndex={-1}
                  aria-selected={!q && cli === tab}
                  className={`account-tab${!q && cli === tab ? ' on' : ''}${q && !n ? ' none' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => openTab(cli)}
                >
                  <span className="account-tab-lab">
                    <ProviderLogo cli={cli} />
                    <span className="account-tab-nm">{AGENT_PROVIDER_LABEL[cli]}</span>
                    <span className="account-tab-n mono">{n}</span>
                  </span>
                  <span className="account-tab-hint mono">
                    {switchHint(cli, current.cli, true)}
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
        <div
          ref={listRef}
          className="mp-list account-list"
          role="listbox"
          aria-label="Accounts"
          id={`accounts-${current.id}`}
        >
          {q
            ? tabs.map((cli) => {
                const group = shown.filter((a) => a.cli === cli)
                if (!group.length) return null
                return (
                  <div key={cli} role="group" aria-label={AGENT_PROVIDER_LABEL[cli]}>
                    <div className="account-group">
                      <ProviderLogo cli={cli} />
                      <span>{cli === 'codex' ? 'ChatGPT · Codex' : AGENT_PROVIDER_LABEL[cli]}</span>
                      <span className="mono">{switchHint(cli, current.cli, false)}</span>
                    </div>
                    {group.map(row)}
                  </div>
                )
              })
            : shown.map(row)}
          {!shown.length ? <div className="mp-empty">No accounts found.</div> : null}
        </div>
      </div>
      <p className="mp-foot">
        ↑↓ move · ↵ choose{tabs.length > 1 ? ' · tab provider' : ''} · esc close
      </p>
    </>
  )
}
