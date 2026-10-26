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
import { AGENT_CLI_LABEL, AGENT_PROVIDER_LABEL } from '@shared/agent-clis'
import { baseName, contractHome, expandHome } from '@shared/paths'
import { useActions, useApp, useServices } from '../../app/services'
import { accountById, findPane } from '../../app/store'
import { pendingApproval, type ChatItem } from '../../lib/chat-thread'
import { buildSlashItems, leadingCommand, type SlashItem } from '../../lib/slash'
import { createPortal } from 'react-dom'
import { IconArrowDown, IconClock, IconClose, IconRestart } from '../icons'
import { fmtUntil } from '../../lib/usage-format'
import { fmtWhen } from '@shared/schedule'
import { useShallow } from 'zustand/react/shallow'
import { Composer } from './Composer'
import { ProviderLogo } from '../ProviderLogo'
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
import { panelDragging } from '../../lib/panel-drag'
import { QuestionCard } from './QuestionCard'
import { ApprovalBar, ToolCard } from './ToolCard'

interface Props {
  paneId: string
  visible: boolean
  focused: boolean
}

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
      // A panel drag gets the frames; the reveal catches up after the release (#126).
      if (!panelDragging()) setShown((n) => paceStep(n, target.current, dt))
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

    case 'handoff':
      return (
        <>
          <div className="cdiv" role="separator">
            <ProviderLogo cli={item.toCli} />
            <span>{item.divider}</span>
          </div>
          <details className="chat-handoff">
            <summary>
              Handoff from {AGENT_PROVIDER_LABEL[item.fromCli]} · {item.messages} messages{' '}
              <span>show</span>
            </summary>
            <pre>{item.text}</pre>
          </details>
        </>
      )
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
function ChatViewBody({ paneId, visible, focused }: Props) {
  const { api, chat, store } = useServices()
  const actions = useActions()
  const drop = useApp((s) => s.chatDrops[paneId] ?? null)
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
  const lastScrollTop = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) {
      el.scrollTop = el.scrollHeight
      lastScrollTop.current = el.scrollTop
    }
  }, [thread, visible])
  // Paced text, images and tool details can resize between thread updates. Follow
  // immediately: a catch-up animation makes the chat keep moving after output arrives.
  const colRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    const col = colRef.current
    if (!el || !col) return
    const ro = new ResizeObserver(() => {
      if (stick.current) {
        el.scrollTop = el.scrollHeight
        lastScrollTop.current = el.scrollTop
      }
    })
    ro.observe(col)
    // The viewport shrinks too (composer grows, approval bar, pane resize).
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const pauseFollow = (): void => {
    stick.current = false
    setAtBottom(false)
  }
  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    // Content growing can increase the bottom gap before its resize callback runs.
    // Only upward movement pauses follow; a gap by itself is not user input.
    const maxTop = el.scrollHeight - el.clientHeight
    if (el.scrollTop < Math.min(lastScrollTop.current, maxTop) - 0.5) stick.current = false
    lastScrollTop.current = el.scrollTop
    // A small upward movement remains paused until the actual bottom is reached.
    if (maxTop - el.scrollTop < 1) stick.current = true
    if (stick.current !== atBottom) setAtBottom(stick.current)
  }

  const jump = (): void => {
    const el = scrollRef.current
    if (!el) return
    stick.current = true
    setAtBottom(true)
    el.scrollTop = el.scrollHeight
    lastScrollTop.current = el.scrollTop
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
  // All accounts: same-CLI continuation or a cross-CLI handoff (#78).
  const accounts = useApp((s) => s.config.accounts)
  const accountInfo = useApp((s) => s.accountInfo)
  const limits = useApp((s) => s.usage.limits)
  // A limit past its reset reads 0%.
  const at = useTicker(60_000)
  const choices = useMemo((): AccountChoice[] => {
    return accounts.map((a) => {
      const five = liveWindow(limits[a.id]?.fiveHour ?? null, at)
      return {
        id: a.id,
        cli: a.cli,
        name: a.name,
        plan: accountInfo[a.id]?.info?.plan ?? null,
        sessionPct: five ? Math.round(five.utilization * 100) : null,
        signedIn: a.signedIn
      }
    })
  }, [accounts, accountInfo, limits, at])
  const branch = useApp((s) => s.git[paneId]?.branch ?? '')
  const currentChoice = choices.find((c) => c.id === account?.id)
  // "Send later" (#77): this chat's queued messages, and when its account's limit resets.
  const queued = useApp(
    useShallow((s) =>
      s.config.schedules.filter(
        (j) => j.oneShot && j.target.kind === 'chat' && j.target.paneId === paneId
      )
    )
  )
  const resetAt = (() => {
    const l = account ? limits[account.id] : undefined
    const times = [l?.fiveHour, l?.sevenDay]
      .map((w) => liveWindow(w ?? null, at))
      .filter((w) => w && w.utilization > 0)
      .map((w) => w!.resetsAt)
      .filter((t) => t > at)
    return times.length ? Math.min(...times) : null
  })()
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
    if (item.name === 'new') actions.chatNew(paneId)
    else if (item.name === 'model') setModelSignal((n) => n + 1)
    else if (item.name === 'effort') setEffortSignal((n) => n + 1)
    else if (item.name === 'mode') setModeSignal((n) => n + 1)
    else if (item.name === 'usage') actions.setView('usage')
  }

  const send = (text: string, images: Parameters<typeof actions.chatSend>[2]): void => {
    stick.current = true
    setAtBottom(true)
    actions.chatSend(paneId, text, images)
  }

  return (
    <div className="chat">
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onWheelCapture={(e) => {
          if (wheelScrollsUp(e.nativeEvent, scrollRef.current)) pauseFollow()
        }}
        onTouchStartCapture={pauseFollow}
        onPointerDown={(e) => {
          // Only a press on the scrollbar; the empty margins beside the column are not input.
          const el = e.currentTarget
          if (e.target === el && e.nativeEvent.offsetX >= el.clientWidth) pauseFollow()
        }}
        onKeyDownCapture={(e) => {
          if (['ArrowUp', 'PageUp', 'Home'].includes(e.key) || (e.key === ' ' && e.shiftKey))
            pauseFollow()
        }}
      >
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
              {account ? (
                <span className="cw-logo" aria-hidden="true">
                  <ProviderLogo cli={account.cli} size={15} fallbackName={account.name} />
                </span>
              ) : null}
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
        {queued.map((j) => (
          <div key={j.id} className="cqueue" role="status" aria-label="Queued message">
            <IconClock small />
            <span className="cqueue-t" title={j.prompt}>
              {j.prompt}
            </span>
            <span className="cqueue-w">
              {j.when.kind === 'reset'
                ? `when ${account?.name ?? 'the'} limit resets${j.nextAt ? ` · ${fmtUntil(j.nextAt, at)}` : ''}`
                : j.nextAt
                  ? `at ${fmtWhen(j.nextAt, at)} · ${fmtUntil(j.nextAt, at)}`
                  : 'queued'}
            </span>
            <button className="btn sm gh" onClick={() => actions.deleteJob(j.id)}>
              Cancel
            </button>
            <button className="btn sm" onClick={() => actions.runJobNow(j.id)}>
              Send now
            </button>
          </div>
        ))}
        {approval?.approval?.questions ? (
          <QuestionCard
            key={approval.approval.reqId}
            questions={approval.approval.questions}
            onAnswer={(answers) =>
              actions.chatApprove(paneId, approval.approval!.reqId, 'allow', answers)
            }
            onSkip={() => actions.chatApprove(paneId, approval.approval!.reqId, 'deny')}
          />
        ) : approval?.approval ? (
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
            <button className="btn" onClick={() => actions.restartPane(paneId)}>
              <IconRestart small /> Restart
            </button>
          </div>
        ) : notSignedIn ? (
          <div className="chat-bar">
            <span>{account.name} is not signed in. Sign in once, then come back.</span>
            <button className="btn" onClick={() => actions.loginAccount(account.id)}>
              Sign in
            </button>
          </div>
        ) : null}
        <Composer
          drop={drop}
          onDropTaken={() => actions.takeChatDrop(paneId)}
          placeholder={`Message ${cliLabel}…`}
          ready={ready}
          busy={thread.busy}
          autoFocus={focused && visible && canTakeFocus}
          meta={[cwdLabel, branch]}
          model={
            // Any CLI whose adapter reports models gets the controls.
            currentChoice || thread.models.length || pane.model ? (
              <>
                {currentChoice ? (
                  <AccountPicker
                    current={currentChoice}
                    accounts={choices}
                    busy={thread.busy}
                    onPick={(id) =>
                      actions.openModal({ kind: 'switchChatAccount', paneId, accountId: id })
                    }
                    onSignIn={(id) => actions.loginAccount(id)}
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
          sendLater={
            account
              ? {
                  reset:
                    resetAt !== null
                      ? {
                          label: `When ${account.name}'s limit resets`,
                          hint: fmtUntil(resetAt, at)
                        }
                      : null,
                  onQueue: (text, when) => actions.queueMessage(paneId, text, when)
                }
              : undefined
          }
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

/**
 * True when a wheel event moves the chat itself up: mostly vertical (a sideways swipe over a
 * code block has small vertical noise), and not taken by an inner box that can still scroll up.
 */
function wheelScrollsUp(e: WheelEvent, chat: HTMLElement | null): boolean {
  if (!chat || e.deltaY >= 0 || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return false
  for (let n = e.target as HTMLElement | null; n && n !== chat; n = n.parentElement) {
    const y = getComputedStyle(n).overflowY
    if ((y === 'auto' || y === 'scroll') && n.scrollTop > 0) return false
  }
  return true
}

/** Memoized: a pane re-renders on every frame its box moves (a panel drag, #126); its body
 *  only needs to when its own props change. */
export const ChatView = memo(ChatViewBody)
