import type { ApprovalDecision, ChatEvent, ChatImage, ChatMode } from '@shared/chat'
import type { WraithApi } from '@shared/ipc-contract'
import {
  EMPTY_THREAD,
  addNotice,
  addUserMessage,
  applyChatEvent,
  chatStatus,
  parseThread,
  serializeThread,
  type ChatThread
} from './chat-thread'

const SAVE_DEBOUNCE_MS = 800

/**
 * Chat panes' conversations (ADR 0002), outside React state like PtyBus: streamed text
 * changes many times a second and only the pane showing it should re-render.
 */
export class ChatBus {
  private readonly threads = new Map<string, ChatThread>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly loaded = new Map<string, Promise<void>>()
  private readonly saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly sessionListeners = new Set<(paneId: string, id: string) => void>()
  private readonly capabilityListeners = new Set<
    (paneId: string, e: Extract<ChatEvent, { t: 'capabilities' }>) => void
  >()
  private readonly exitListeners = new Set<
    (paneId: string, e: Extract<ChatEvent, { t: 'exit' }>) => void
  >()
  private readonly usageListeners = new Set<
    (paneId: string, e: Extract<ChatEvent, { t: 'limits' | 'turnEnd' }>) => void
  >()
  private readonly modeListeners = new Set<(paneId: string, mode: ChatMode) => void>()
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly api: WraithApi['chat'],
    private readonly now: () => number = () => Date.now()
  ) {}

  start(): void {
    this.unsubscribe = this.api.onEvent(({ paneId, event }) => this.handle(paneId, event))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private handle(paneId: string, e: ChatEvent): void {
    this.set(paneId, applyChatEvent(this.thread(paneId), e, this.now()))
    if (e.t === 'session') this.sessionListeners.forEach((cb) => cb(paneId, e.id))
    if (e.t === 'exit') this.exitListeners.forEach((cb) => cb(paneId, e))
    if (e.t === 'capabilities') this.capabilityListeners.forEach((cb) => cb(paneId, e))
    if (e.t === 'mode') this.modeListeners.forEach((cb) => cb(paneId, e.mode))
    if (e.t === 'limits' || e.t === 'turnEnd') this.usageListeners.forEach((cb) => cb(paneId, e))
    // Streaming text is saved once the turn settles, not on every delta.
    if (e.t !== 'text' && e.t !== 'thinking') this.scheduleSave(paneId)
  }

  thread(paneId: string): ChatThread {
    return this.threads.get(paneId) ?? EMPTY_THREAD
  }

  status(paneId: string): ReturnType<typeof chatStatus> {
    return chatStatus(this.thread(paneId))
  }

  subscribe(paneId: string, cb: () => void): () => void {
    let set = this.listeners.get(paneId)
    if (!set) this.listeners.set(paneId, (set = new Set()))
    set.add(cb)
    return () => set.delete(cb)
  }

  onSession(cb: (paneId: string, id: string) => void): () => void {
    this.sessionListeners.add(cb)
    return () => this.sessionListeners.delete(cb)
  }

  onCapabilities(
    cb: (paneId: string, e: Extract<ChatEvent, { t: 'capabilities' }>) => void
  ): () => void {
    this.capabilityListeners.add(cb)
    return () => this.capabilityListeners.delete(cb)
  }

  onMode(cb: (paneId: string, mode: ChatMode) => void): () => void {
    this.modeListeners.add(cb)
    return () => this.modeListeners.delete(cb)
  }

  /** Plan limits and finished turns, for the usage panel. */
  onUsage(
    cb: (paneId: string, e: Extract<ChatEvent, { t: 'limits' | 'turnEnd' }>) => void
  ): () => void {
    this.usageListeners.add(cb)
    return () => this.usageListeners.delete(cb)
  }

  onExit(cb: (paneId: string, e: Extract<ChatEvent, { t: 'exit' }>) => void): () => void {
    this.exitListeners.add(cb)
    return () => this.exitListeners.delete(cb)
  }

  /** Reads the saved view once; events that arrived first stay after it. */
  load(paneId: string): Promise<void> {
    let p = this.loaded.get(paneId)
    if (!p) {
      p = this.api.load(paneId).then((raw) => {
        const saved = parseThread(raw)
        const live = this.thread(paneId)
        this.set(paneId, {
          ...live,
          items: [...saved.items, ...live.items],
          sessionId: live.sessionId ?? saved.sessionId,
          model: live.model ?? saved.model,
          seq: saved.seq + live.seq,
          restored: saved.items.length,
          models: live.models.length ? live.models : saved.models
        })
      })
      this.loaded.set(paneId, p)
    }
    return p
  }

  send(paneId: string, text: string, images: ChatImage[]): void {
    this.set(paneId, addUserMessage(this.thread(paneId), text, images.length, this.now()))
    this.api.send(paneId, text, images)
    this.scheduleSave(paneId)
  }

  approve(paneId: string, reqId: string, decision: ApprovalDecision): void {
    this.api.approve(paneId, reqId, decision)
  }

  interrupt(paneId: string): void {
    this.api.interrupt(paneId)
  }

  /** Ends the running turn here (its process was stopped), with a note why. */
  settle(paneId: string, text: string): void {
    const t = applyChatEvent(this.thread(paneId), { t: 'busy', busy: false }, this.now())
    this.set(paneId, addNotice({ ...t, background: [] }, 'info', text))
    this.scheduleSave(paneId)
  }

  notice(paneId: string, level: 'info' | 'error' | 'divider', text: string): void {
    this.set(paneId, addNotice(this.thread(paneId), level, text))
    this.scheduleSave(paneId)
  }

  /** A new conversation: the view starts empty and the next start makes a new session. */
  clear(paneId: string): void {
    this.set(paneId, EMPTY_THREAD)
    this.scheduleSave(paneId)
  }

  /** The pane closed: drop it from memory. `keep` saves its view first (archived to History). */
  forget(paneId: string, keep = false): void {
    const timer = this.saveTimers.get(paneId)
    if (timer) clearTimeout(timer)
    if (keep && this.threads.has(paneId))
      this.api.save(paneId, serializeThread(this.thread(paneId)))
    this.saveTimers.delete(paneId)
    this.threads.delete(paneId)
    this.loaded.delete(paneId)
    this.listeners.delete(paneId)
  }

  private set(paneId: string, t: ChatThread): void {
    this.threads.set(paneId, t)
    this.listeners.get(paneId)?.forEach((cb) => cb())
  }

  private scheduleSave(paneId: string): void {
    const prev = this.saveTimers.get(paneId)
    if (prev) clearTimeout(prev)
    this.saveTimers.set(
      paneId,
      setTimeout(() => {
        this.saveTimers.delete(paneId)
        if (this.threads.has(paneId)) this.api.save(paneId, serializeThread(this.thread(paneId)))
      }, SAVE_DEBOUNCE_MS)
    )
  }
}
