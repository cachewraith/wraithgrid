import type { AgentCli } from '@shared/agent-clis'
import type { ChatHandoff } from './chat-handoff'
import type { ApprovalDecision, ChatAnswers, ChatEvent, ChatImage, ChatMode } from '@shared/chat'
import type { WraithApi } from '@shared/ipc-contract'
import {
  EMPTY_THREAD,
  addNotice,
  addUserMessage,
  applyChatEvent,
  capItems,
  chatStatus,
  parseThread,
  serializeThread,
  setUserThumbs,
  type ChatThread
} from './chat-thread'

const SAVE_DEBOUNCE_MS = 800
/** Messages per pane whose sent images stay at full size; older ones show their thumbs (#141). */
const FULL_IMAGE_MESSAGES = 6

/**
 * Chat panes' conversations (ADR 0002), outside React state like PtyBus: streamed text
 * changes many times a second and only the pane showing it should re-render.
 */
export class ChatBus {
  private readonly threads = new Map<string, ChatThread>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly loaded = new Map<string, Promise<void>>()
  private readonly saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Panes with streamed text since their last save: no timer runs for deltas (#136). */
  private readonly unsaved = new Set<string>()
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
  /** Sent images at full size, per pane and message: memory only, never saved (#50). */
  private readonly fullImages = new Map<string, Map<string, string[]>>()
  private readonly forgotten = new Set<string>()
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly api: WraithApi['chat'],
    private readonly now: () => number = () => Date.now(),
    /** Small data URLs for the bubble and the saved view; none by default. */
    private readonly makeThumbs: (images: ChatImage[]) => Promise<string[]> = async () => []
  ) {}

  start(): void {
    this.unsubscribe = this.api.onEvent(({ paneId, event }) => this.handle(paneId, event))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private handle(paneId: string, e: ChatEvent): void {
    if (this.forgotten.has(paneId)) return
    this.set(paneId, applyChatEvent(this.thread(paneId), e, this.now()))
    if (e.t === 'session') this.sessionListeners.forEach((cb) => cb(paneId, e.id))
    if (e.t === 'exit') this.exitListeners.forEach((cb) => cb(paneId, e))
    if (e.t === 'capabilities') this.capabilityListeners.forEach((cb) => cb(paneId, e))
    if (e.t === 'mode') this.modeListeners.forEach((cb) => cb(paneId, e.mode))
    if (e.t === 'limits' || e.t === 'turnEnd') this.usageListeners.forEach((cb) => cb(paneId, e))
    // Streaming text is saved once the turn settles, not on every delta.
    if (e.t !== 'text' && e.t !== 'thinking') this.scheduleSave(paneId)
    else this.unsaved.add(paneId)
  }

  /** Saves every view with changes not saved yet, now: the window is going away (#136). */
  flush(): void {
    for (const paneId of new Set([...this.saveTimers.keys(), ...this.unsaved])) {
      const timer = this.saveTimers.get(paneId)
      if (timer) clearTimeout(timer)
      this.saveNow(paneId)
    }
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
    this.forgotten.delete(paneId)
    let p = this.loaded.get(paneId)
    if (!p) {
      const mine = (p = this.api.load(paneId).then((raw) => {
        // Forgotten (and maybe opened again) while reading: a newer load owns the view (#140).
        if (this.loaded.get(paneId) !== mine) return
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
      }))
      this.loaded.set(paneId, p)
    }
    return p
  }

  send(paneId: string, text: string, images: ChatImage[]): void {
    const t = addUserMessage(this.thread(paneId), text, images.length, this.now())
    this.set(paneId, t)
    this.api.send(paneId, text, images)
    this.scheduleSave(paneId)
    if (!images.length) return
    const id = t.items.at(-1)!.id
    let full = this.fullImages.get(paneId)
    if (!full) this.fullImages.set(paneId, (full = new Map()))
    full.set(
      id,
      images.map((img) => `data:${img.mediaType};base64,${img.data}`)
    )
    // A Map keeps insertion order: the first key is the oldest message.
    if (full.size > FULL_IMAGE_MESSAGES) full.delete(full.keys().next().value!)
    void this.makeThumbs(images).then((thumbs) => {
      if (!thumbs.length || !this.threads.has(paneId)) return
      this.set(paneId, setUserThumbs(this.thread(paneId), id, thumbs))
      this.scheduleSave(paneId)
    })
  }

  /** The first prompt of a cross-CLI chat is shown as a collapsed handoff, not a bubble. */
  prepareHandoff(paneId: string, handoff: ChatHandoff, toCli: AgentCli, divider: string): void {
    const t = this.thread(paneId)
    this.set(paneId, {
      ...t,
      seq: t.seq + 1,
      items: [...t.items, { kind: 'handoff', id: `h-${t.seq + 1}`, ...handoff, toCli, divider }]
    })
    this.scheduleSave(paneId)
  }

  /** Called only once the new CLI starts; a failed start can retry the saved first prompt. */
  sendPreparedHandoff(paneId: string): void {
    const t = this.thread(paneId)
    const handoff = t.items.find((it) => it.kind === 'handoff')
    if (handoff?.kind !== 'handoff') return
    this.set(paneId, { ...t, busy: true, turnStartedAt: this.now() })
    this.api.send(paneId, handoff.text, [])
    this.scheduleSave(paneId)
  }

  /** A sent message's images at full size, while this run of the app still has them. */
  images(paneId: string, itemId: string): string[] | null {
    return this.fullImages.get(paneId)?.get(itemId) ?? null
  }

  approve(paneId: string, reqId: string, decision: ApprovalDecision, answers?: ChatAnswers): void {
    this.api.approve(paneId, reqId, decision, answers)
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
    this.fullImages.delete(paneId)
    this.set(paneId, EMPTY_THREAD)
    this.scheduleSave(paneId)
  }

  /** The pane closed: drop it from memory. `keep` saves its view first (archived to History). */
  forget(paneId: string, keep = false): void {
    this.forgotten.add(paneId)
    const timer = this.saveTimers.get(paneId)
    if (timer) clearTimeout(timer)
    if (keep && this.threads.has(paneId))
      this.api.save(paneId, serializeThread(this.thread(paneId)))
    this.saveTimers.delete(paneId)
    this.unsaved.delete(paneId)
    this.threads.delete(paneId)
    this.fullImages.delete(paneId)
    this.loaded.delete(paneId)
    this.listeners.delete(paneId)
  }

  private set(paneId: string, t: ChatThread): void {
    this.threads.set(paneId, capItems(t))
    this.listeners.get(paneId)?.forEach((cb) => cb())
  }

  private scheduleSave(paneId: string): void {
    const prev = this.saveTimers.get(paneId)
    if (prev) clearTimeout(prev)
    this.saveTimers.set(
      paneId,
      setTimeout(() => this.saveNow(paneId), SAVE_DEBOUNCE_MS)
    )
  }

  private saveNow(paneId: string): void {
    this.saveTimers.delete(paneId)
    this.unsaved.delete(paneId)
    if (this.threads.has(paneId)) this.api.save(paneId, serializeThread(this.thread(paneId)))
  }
}
