import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { AGENT_CLI_LABEL } from '@shared/agent-clis'
import { baseName, contractHome, expandHome } from '@shared/paths'
import { useActions, useApp, useServices } from '../../app/services'
import { accountById, findPane } from '../../app/store'
import { pendingApproval, type ChatItem } from '../../lib/chat-thread'
import { IconArrowDown, IconRestart, IconTerminal } from '../icons'
import { Composer } from './Composer'
import { ModelPicker } from './ModelPicker'
import { CopyButton, Markdown } from './Markdown'
import { ApprovalBar, ToolCard } from './ToolCard'

interface Props {
  paneId: string
  visible: boolean
  focused: boolean
}

const STICK_PX = 48

const SUGGESTIONS = [
  'Explain how this project is put together',
  'Review my uncommitted changes',
  'Find and fix a bug',
  'Write tests for the latest change'
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

const Item = memo(function Item({
  item,
  live,
  streaming,
  cwd
}: {
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
            {item.images ? (
              <span className="cmsg-imgs">
                {item.images} image{item.images === 1 ? '' : 's'}
              </span>
            ) : null}
            {item.text}
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div className={`cmsg agent${streaming ? ' streaming' : ''}`}>
          <Markdown text={item.text} />
          {streaming ? null : (
            <div className="cmsg-tools">
              <CopyButton text={item.text} label="Copy answer" />
            </div>
          )}
        </div>
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
      return <div className={`cnote ${item.level}`}>{item.text}</div>
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
  const { chat, store } = useServices()
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
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [thread, visible])
  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
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
  if (!pane) return null

  const cwdAbs = expandHome(pane.cwd, home)
  const cwdLabel = contractHome(cwdAbs, home)
  const cliLabel = account ? AGENT_CLI_LABEL[account.cli] : 'agent'
  const approval = thread.busy ? pendingApproval(thread) : null
  const last = thread.items[thread.items.length - 1]
  const streamingId = thread.busy && last?.kind === 'assistant' ? last.id : null
  const ready = started && !exit
  const notSignedIn = !!account && !account.signedIn

  const send = (text: string, images: Parameters<typeof actions.chatSend>[2]): void => {
    stick.current = true
    setAtBottom(true)
    actions.chatSend(paneId, text, images)
  }

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-col">
          {thread.items.length === 0 ? (
            <div className="chat-hello">
              <div className="chat-hello-mark" aria-hidden="true" />
              <h2>What should we build?</h2>
              <p>
                {cliLabel}
                {account ? ` · ${account.name}` : ''} · <span className="mono">{cwdLabel}</span>
              </p>
              <div className="chat-sugs">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s}
                    className="chat-sug"
                    style={{ animationDelay: `${80 + i * 50}ms` }}
                    disabled={!ready}
                    onClick={() => send(s, [])}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            thread.items.map((it, i) => {
              return (
                <div key={it.id} className={`chat-it${i >= still ? ' enter' : ''}`}>
                  <Item
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
            // Any CLI whose adapter reports models gets the picker.
            thread.models.length || pane.model ? (
              <ModelPicker
                models={thread.models}
                model={pane.model}
                effort={pane.effort}
                running={thread.model}
                busy={thread.busy}
                onModel={(m) => actions.chatSetModel(paneId, m)}
                onEffort={(e) => actions.chatSetEffort(paneId, e)}
              />
            ) : null
          }
          onSend={send}
          onStop={() => actions.chatInterrupt(paneId)}
        />
      </div>
    </div>
  )
}
