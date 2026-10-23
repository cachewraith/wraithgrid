import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { AGENT_CLI_LABEL } from '@shared/agent-clis'
import { baseName, contractHome, expandHome } from '@shared/paths'
import { useActions, useApp, useServices } from '../../app/services'
import { accountById, findPane } from '../../app/store'
import { pendingApproval, type ChatItem } from '../../lib/chat-thread'
import { buildSlashItems, leadingCommand, type SlashItem } from '../../lib/slash'
import { createPortal } from 'react-dom'
import { IconArrowDown, IconClose, IconRestart, IconTerminal } from '../icons'
import { Composer } from './Composer'
import { cycleModes, type ChatBackgroundTask } from '@shared/chat'
import {
  AccountPicker,
  EffortPicker,
  ModePicker,
  ModelPicker,
  type AccountChoice
} from './ModelPicker'
import { liveWindow } from '@shared/usage'
import { useTicker } from '../UsageView'
import { CopyButton, Markdown } from './Markdown'
import { paceStep, revealedWords } from '../../lib/stream-pace'
import { ApprovalBar, ToolCard } from './ToolCard'

interface Props {
  paneId: string
  visible: boolean
  focused: boolean
}

const STICK_PX = 48

/** Starters on a new chat's first screen: what is sent, and a line on what it does. */
const SUGGESTIONS: { text: string; hint: string }[] = [
  {
    text: 'Explain how this project is put together',
    hint: 'A map of its folders and how they fit'
  },
  { text: 'Review my uncommitted changes', hint: 'Before you commit them' },
  { text: 'Find and fix a bug', hint: 'Say what goes wrong; it reproduces it first' },
  { text: 'Write tests for the latest change', hint: 'Reads the last commit and covers it' }
]

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Seconds since `since`, ticking while it is set. */
function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === null) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [since])
  return since === null ? 0 : Math.max(0, now - since)
}

/**
 * Work the agent left running after its turn (#39): says the chat is waiting on it, not
 * stopped. claude reads each result in a turn of its own when it ends.
 */
function BackgroundTasks({ tasks }: { tasks: ChatBackgroundTask[] }) {
  const now = useTicker(1000)
  return (
    <div className="chat-bg" role="status" aria-live="polite">
      <div className="cb-head">
        <span className="pn-spin bg" aria-hidden="true" />
        <span>
          {tasks.length === 1 ? 'Running in background' : `${tasks.length} running in background`}
        </span>
        <span className="cb-hint">it reports back when done</span>
      </div>
      {tasks.map((x) => (
        <div key={x.id} className="cb-task">
          <span className="cb-kind">
            {x.kind === 'shell' ? '$' : x.kind === 'agent' ? '◇' : '•'}
          </span>
          <span className="cb-label" title={x.label}>
            {x.label}
          </span>
          <span className="cw-time">{formatDuration(Math.max(0, now - x.since))}</span>
        </div>
      ))}
    </div>
  )
}

/** A sent message's images as tiles (#50); a click opens them at full size. */
function UserImages({
  paneId,
  item
}: {
  paneId: string
  item: Extract<ChatItem, { kind: 'user' }>
}) {
  const { chat } = useServices()
  const [open, setOpen] = useState<number | null>(null)
  const thumbs = item.thumbs ?? []
  if (!thumbs.length)
    // Saved before thumbnails, or still being made: the count.
    return item.images ? (
      <span className="cmsg-imgs">
        {item.images} image{item.images === 1 ? '' : 's'}
      </span>
    ) : null
  return (
    <>
      <div className={`cmsg-thumbs${thumbs.length === 1 ? ' one' : ''}`}>
        {thumbs.map((src, i) => (
          <button
            key={i}
            className="cmsg-thumb"
            aria-label={`Open image ${i + 1} of ${thumbs.length}`}
            onClick={() => setOpen(i)}
          >
            <img src={src} alt="" draggable={false} />
          </button>
        ))}
      </div>
      {open !== null ? (
        <ImageViewer
          images={chat.images(paneId, item.id) ?? thumbs}
          at={Math.min(open, thumbs.length - 1)}
          onMove={setOpen}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  )
}

/** One image over the whole window: Esc or a click closes it, ← → step through the message's. */
function ImageViewer({
  images,
  at,
  onMove,
  onClose
}: {
  images: string[]
  at: number
  onMove: (i: number) => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => prev?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && at > 0) onMove(at - 1)
      else if (e.key === 'ArrowRight' && at < images.length - 1) onMove(at + 1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [at, images.length, onClose, onMove])
  const label = images.length > 1 ? `Image ${at + 1} of ${images.length}` : 'Image'
  return createPortal(
    <div
      className="chat-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <img src={images[at]} alt={label} draggable={false} />
      <button ref={closeRef} className="chat-viewer-close" aria-label="Close image">
        <IconClose />
      </button>
      {images.length > 1 ? <span className="chat-viewer-count">{label}</span> : null}
    </div>,
    document.body
  )
}

/** The theme or the system asks for no motion: text then appears as it arrives. */
const motionReduced = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.dataset.motion === 'reduced' ||
  document.documentElement.dataset.motion === 'off'

/**
 * Streamed text revealed at a steady pace (#52), a whole word at a time (#62), instead of in the
 * bursts it arrives in. Once
 * the stream ends (turn over, Stop, or a tool call next) all of it shows at once.
 */
function usePacedText(text: string, streaming: boolean): string {
  const [paced] = useState(() => streaming && !motionReduced())
  // A long answer already there when the view opened (back to the pane) isn't replayed.
  const [shown, setShown] = useState(() => (paced && text.length < 200 ? 0 : text.length))
  const target = useRef(text.length)
  useLayoutEffect(() => {
    target.current = text.length
  })
  const on = paced && streaming
  useEffect(() => {
    if (!on) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = now - last
      last = now
      setShown((n) => paceStep(n, target.current, dt))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [on])
  return on ? revealedWords(text, shown) : text
}

function AgentMessage({ text, streaming }: { text: string; streaming: boolean }) {
  const shown = usePacedText(text, streaming)
  return (
    <div className={`cmsg agent${streaming ? ' streaming' : ''}`}>
      <Markdown text={shown} streaming={streaming} />
      {streaming ? null : (
        <div className="cmsg-tools">
          <CopyButton text={text} label="Copy answer" />
        </div>
      )}
    </div>
  )
}

const Item = memo(function Item({
  paneId,
  item,
  live,
  streaming,
  cwd
}: {
  paneId: string
  item: ChatItem
  live: boolean
  streaming: boolean
  cwd: string
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="cmsg user">
          <div className="cmsg-bubble">
            <UserImages paneId={paneId} item={item} />
            <UserText text={item.text} />
          </div>
        </div>
      )
    case 'assistant':
      return <AgentMessage text={item.text} streaming={streaming} />

    case 'thinking':
      return item.text.trim() ? (
        <details className="cthink">
          <summary>Thought process</summary>
          <div className="cthink-body">{item.text}</div>
        </details>
      ) : null
    case 'tool':
      return <ToolCard item={item} live={live} cwd={cwd} />
    case 'notice':
      return item.level === 'divider' ? (
        <div className="cdiv" role="separator" aria-label={item.text}>
          <span>{item.text}</span>
        </div>
      ) : (
        <div className={`cnote ${item.level}`}>{item.text}</div>
      )
    case 'turn':
      return item.error ? (
        <div className="cnote error">{item.error}</div>
      ) : item.durationMs !== null || item.costUsd !== null ? (
        <div className="cturn">
          {[
            item.durationMs !== null ? formatDuration(item.durationMs) : null,
            item.costUsd ? `$${item.costUsd.toFixed(item.costUsd < 0.01 ? 4 : 2)}` : null
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      ) : null
  }
})

/**
 * A chat pane (ADR 0002): the conversation with the pane's CLI running headless. It never
 * knows which CLI that is; main's adapter turned the CLI's output into ChatEvents.
 */
export function ChatView({ paneId, visible, focused }: Props) {
  const { api, chat, store } = useServices()
  const actions = useActions()
  const thread = useSyncExternalStore(
    useCallback((cb) => chat.subscribe(paneId, cb), [chat, paneId]),
    () => chat.thread(paneId)
  )
  const pane = useApp((s) => findPane(s.config, paneId)?.pane)
  const account = useApp((s) => accountById(s.config, pane?.accountId ?? null))
  const started = useApp((s) => !!s.runtime[paneId]?.started)
  const exit = useApp((s) => s.runtime[paneId]?.exit ?? null)
  const home = useApp((s) => s.info.homeDir)
  const canTakeFocus = useApp(
    (s) => s.view === 'grid' && s.modal === null && s.closingPaneId !== paneId
  )

  useEffect(() => {
    store.getState().requestStart(paneId)
  }, [store, paneId])

  // Follow new output while the view is at the bottom; leave it alone once scrolled up.
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  // A glide toward the bottom while streamed text grows (#62); `glideAt` is where it last put
  // the view, so its own scrolling isn't taken for the user scrolling up.
  const glide = useRef(0)
  const glideAt = useRef(0)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current && !glide.current) el.scrollTop = el.scrollHeight
  }, [thread, visible])
  // Paced text grows between thread updates (#52): follow the column's height too, gliding
  // a quarter of the way each frame instead of jumping a line at a time.
  const colRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    const col = colRef.current
    if (!el || !col) return
    const step = (): void => {
      const gap = el.scrollHeight - el.clientHeight - el.scrollTop
      if (!stick.current || gap <= 1) {
        glide.current = 0
        return
      }
      el.scrollTop += Math.max(1, gap / 4)
      glideAt.current = el.scrollTop
      glide.current = requestAnimationFrame(step)
    }
    const ro = new ResizeObserver(() => {
      if (!stick.current) return
      if (motionReduced()) el.scrollTop = el.scrollHeight
      else if (!glide.current) glide.current = requestAnimationFrame(step)
    })
    ro.observe(col)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(glide.current)
      glide.current = 0
    }
  }, [])
  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    // The glide's own scroll: only moving up from where it put the view is the user.
    if (glide.current && el.scrollTop >= glideAt.current - 2) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
    stick.current = bottom
    if (bottom !== atBottom) setAtBottom(bottom)
  }
  const jump = (): void => {
    const el = scrollRef.current
    if (!el) return
    stick.current = true
    setAtBottom(true)
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  // Items already there when the view opened, or read from disk, appear at once; new ones
  // animate in.
  const [opened] = useState(() => chat.thread(paneId).items.length)
  const still = Math.max(opened, thread.restored)

  const elapsed = useElapsed(thread.busy ? thread.turnStartedAt : null)
  // The `/` menu: the CLI's commands for this chat.
  const [modelSignal, setModelSignal] = useState(0)
  const [effortSignal, setEffortSignal] = useState(0)
  const [modeSignal, setModeSignal] = useState(0)
  const slashItems = useMemo(
    () => buildSlashItems(thread.commands, thread.terminalOnly),
    [thread.commands, thread.terminalOnly]
  )
  // "Continue as…": the claude accounts this chat could carry on as (#29).
  const accounts = useApp((s) => s.config.accounts)
  const accountInfo = useApp((s) => s.accountInfo)
  const limits = useApp((s) => s.usage.limits)
  // A limit past its reset reads 0%.
  const at = useTicker(60_000)
  const choices = useMemo((): AccountChoice[] => {
    return accounts
      .filter((a) => a.cli === 'claude')
      .map((a) => {
        const five = liveWindow(limits[a.id]?.fiveHour ?? null, at)
        return {
          id: a.id,
          name: a.name,
          plan: accountInfo[a.id]?.info?.plan ?? null,
          sessionPct: five ? Math.round(five.utilization * 100) : null,
          signedIn: a.signedIn
        }
      })
  }, [accounts, accountInfo, limits, at])
  const currentChoice = choices.find((c) => c.id === account?.id)
  if (!pane) return null

  const cwdAbs = expandHome(pane.cwd, home)
  const cwdLabel = contractHome(cwdAbs, home)
  const cliLabel = account ? AGENT_CLI_LABEL[account.cli] : 'agent'
  const approval = thread.busy ? pendingApproval(thread) : null
  const last = thread.items[thread.items.length - 1]
  const streamingId = thread.busy && last?.kind === 'assistant' ? last.id : null
  const ready = started && !exit
  const notSignedIn = !!account && !account.signedIn

  // What the `/` menu's own commands do.
  const chosenModel =
    thread.models.find((m) => m.value === (pane.model ?? 'default')) ?? thread.models[0]
  const autoMode = chosenModel?.autoMode === true
  // The pick shows at once; `pane.chatMode` also follows what the CLI reports (and a refused
  // switch puts it back), so waiting for the CLI here only made the picker look stuck.
  const mode = pane.chatMode ?? 'default'
  const runCommand = (item: SlashItem): void => {
    if (item.group === 'terminal') {
      // The CLI's own screen starts (or comes forward); the command waits there for Enter.
      actions.setPaneView(paneId, 'terminal')
      setTimeout(() => actions.typeInPane(paneId, `/${item.name}`), 1500)
      return
    }
    if (item.name === 'new') actions.chatNew(paneId)
    else if (item.name === 'model') setModelSignal((n) => n + 1)
    else if (item.name === 'effort') setEffortSignal((n) => n + 1)
    else if (item.name === 'mode') setModeSignal((n) => n + 1)
    else if (item.name === 'usage') actions.setView('usage')
    else if (item.name === 'terminal') actions.setPaneView(paneId, 'terminal')
  }

  const send = (text: string, images: Parameters<typeof actions.chatSend>[2]): void => {
    stick.current = true
    setAtBottom(true)
    actions.chatSend(paneId, text, images)
  }

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-col" ref={colRef}>
          {thread.items.length === 0 ? (
            <div className="chat-hello">
              <div className="chat-hello-mark" aria-hidden="true" />
              <h2>What should we build in {baseName(cwdLabel) || 'this folder'}?</h2>
              <p>
                {cliLabel}
                {account ? ` · ${account.name}` : ''} · <span className="mono">{cwdLabel}</span>
              </p>
              <div className="chat-sugs">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s.text}
                    className="chat-sug"
                    style={{ animationDelay: `${80 + i * 50}ms` }}
                    disabled={!ready}
                    onClick={() => send(s.text, [])}
                  >
                    {s.text}
                    <span>{s.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            thread.items.map((it, i) => {
              return (
                <div key={it.id} className={`chat-it ${it.kind}${i >= still ? ' enter' : ''}`}>
                  <Item
                    paneId={paneId}
                    item={it}
                    live={thread.busy}
                    streaming={it.id === streamingId}
                    cwd={cwdAbs}
                  />
                </div>
              )
            })
          )}
          {thread.busy && !approval && !streamingId ? (
            <div className="chat-working" aria-live="polite">
              <span className="cw-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="cw-label">{last?.kind === 'tool' ? 'Working' : 'Thinking'}</span>
              {elapsed >= 2000 ? <span className="cw-time">{formatDuration(elapsed)}</span> : null}
            </div>
          ) : null}
          {thread.background.length ? <BackgroundTasks tasks={thread.background} /> : null}
        </div>
      </div>
      {atBottom ? null : (
        <button className="chat-jump" aria-label="Scroll to the latest message" onClick={jump}>
          <IconArrowDown small />
        </button>
      )}
      <div className="chat-foot">
        {approval?.approval ? (
          <ApprovalBar
            key={approval.approval.reqId}
            item={approval}
            onDecide={(d) => actions.chatApprove(paneId, approval.approval!.reqId, d)}
          />
        ) : null}
        {exit ? (
          <div className="chat-bar err">
            <span>
              {exit.spawnError
                ? (exit.message ?? 'The agent could not start.')
                : 'The agent stopped.'}
              {!exit.spawnError && exit.message ? (
                <span className="mono"> {exit.message}</span>
              ) : null}
            </span>
            <button className="btn gh" onClick={() => actions.setPaneView(paneId, 'terminal')}>
              <IconTerminal small /> Open as terminal
            </button>
            <button className="btn" onClick={() => actions.restartPane(paneId)}>
              <IconRestart small /> Restart
            </button>
          </div>
        ) : notSignedIn ? (
          <div className="chat-bar">
            <span>
              {account.name} is not signed in. Sign in once in the terminal view, then come back.
            </span>
            <button className="btn" onClick={() => actions.setPaneView(paneId, 'terminal')}>
              <IconTerminal small /> Open as terminal
            </button>
          </div>
        ) : null}
        <Composer
          placeholder={`Message ${cliLabel}…`}
          ready={ready}
          busy={thread.busy}
          autoFocus={focused && visible && canTakeFocus}
          meta={[baseName(cwdLabel)]}
          model={
            // Any CLI whose adapter reports models gets the controls.
            thread.models.length || pane.model ? (
              <>
                {currentChoice && choices.length > 1 ? (
                  <AccountPicker
                    current={currentChoice}
                    accounts={choices}
                    busy={thread.busy}
                    onPick={(id) =>
                      actions.openModal({ kind: 'switchChatAccount', paneId, accountId: id })
                    }
                    onSignIn={(id) => actions.openModal({ kind: 'login', accountId: id })}
                  />
                ) : null}
                <ModelPicker
                  models={thread.models}
                  model={pane.model}
                  running={thread.model}
                  openSignal={modelSignal}
                  onModel={(m) => actions.chatSetModel(paneId, m)}
                />
                <EffortPicker
                  efforts={chosenModel?.efforts ?? []}
                  effort={pane.effort}
                  busy={thread.busy}
                  openSignal={effortSignal}
                  onEffort={(e) => actions.chatSetEffort(paneId, e)}
                />
                <ModePicker
                  mode={mode}
                  autoMode={autoMode}
                  modes={thread.controls?.modes}
                  asks={thread.controls?.approvals ?? true}
                  openSignal={modeSignal}
                  onMode={(m) => actions.chatSetMode(paneId, m)}
                />
              </>
            ) : null
          }
          onCycleMode={() => {
            const list = cycleModes(autoMode).filter(
              (m) => !thread.controls || thread.controls.modes.includes(m)
            )
            actions.chatSetMode(paneId, list[(list.indexOf(mode) + 1) % list.length]!)
          }}
          commands={slashItems}
          onCommand={runCommand}
          onSend={send}
          onStop={() => actions.chatInterrupt(paneId)}
          onPickFiles={() => api.chat.pickFiles(paneId)}
          filePath={api.chat.filePath}
        />
      </div>
    </div>
  )
}

/** A message that starts with `/command` shows the command as a chip. */
function UserText({ text }: { text: string }) {
  const cmd = leadingCommand(text)
  if (!cmd) return <>{text}</>
  return (
    <>
      <span className="cmd-chip">/{cmd.name}</span>
      {cmd.rest ? ` ${cmd.rest}` : null}
    </>
  )
}
