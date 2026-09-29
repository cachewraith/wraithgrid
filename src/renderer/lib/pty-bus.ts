import type { PtyExitEvent, WraithApi } from '@shared/ipc-contract'
import { stripAnsi } from './ansi'
import { APPROVAL_PATTERN, ECHO_WINDOW_MS, LOGIN_PATTERN, type PaneActivity } from './status'

type Sink = (data: string) => void

interface PaneTrack extends PaneActivity {
  tail: string
}

const TAIL_MAX = 4000
const PENDING_MAX = 1_000_000

/**
 * Routes PTY output to the right xterm instance without going through React state,
 * and keeps the small activity record that pane status is derived from.
 */
export class PtyBus {
  private readonly sinks = new Map<string, Sink>()
  private readonly pending = new Map<string, string>()
  private readonly tracks = new Map<string, PaneTrack>()
  private readonly sizes = new Map<string, { cols: number; rows: number }>()
  private readonly exitListeners = new Set<(e: PtyExitEvent) => void>()
  private readonly loginListeners = new Set<(paneId: string) => void>()
  private unsubscribe: (() => void)[] = []

  constructor(
    private readonly pty: WraithApi['pty'],
    private readonly now: () => number = () => Date.now()
  ) {}

  start(): void {
    this.unsubscribe = [
      this.pty.onData((e) => this.handleData(e.paneId, e.data)),
      this.pty.onExit((e) => this.exitListeners.forEach((cb) => cb(e)))
    ]
  }

  stop(): void {
    this.unsubscribe.forEach((u) => u())
    this.unsubscribe = []
  }

  attach(paneId: string, sink: Sink): () => void {
    this.sinks.set(paneId, sink)
    const queued = this.pending.get(paneId)
    if (queued) {
      this.pending.delete(paneId)
      sink(queued)
    }
    return () => {
      if (this.sinks.get(paneId) === sink) this.sinks.delete(paneId)
    }
  }

  /** Writes text to the pane's screen only (e.g. the "restarted" marker). */
  writeLocal(paneId: string, text: string): void {
    this.sinks.get(paneId)?.(text)
  }

  input(paneId: string, data: string): void {
    this.track(paneId).lastInputAt = this.now()
    this.pty.write(paneId, data)
  }

  resize(paneId: string, cols: number, rows: number): void {
    const prev = this.sizes.get(paneId)
    if (prev && prev.cols === cols && prev.rows === rows) return
    this.sizes.set(paneId, { cols, rows })
    this.pty.resize(paneId, cols, rows)
  }

  size(paneId: string): { cols: number; rows: number } {
    return this.sizes.get(paneId) ?? { cols: 80, rows: 24 }
  }

  /** Records the size xterm fitted to, without telling main (used before spawn). */
  noteSize(paneId: string, cols: number, rows: number): void {
    this.sizes.set(paneId, { cols, rows })
  }

  activity(paneId: string): PaneActivity | undefined {
    return this.tracks.get(paneId)
  }

  tail(paneId: string): string {
    return this.tracks.get(paneId)?.tail ?? ''
  }

  /** Clears activity for a fresh process (restart). Scrollback stays on screen. */
  resetActivity(paneId: string): void {
    this.tracks.delete(paneId)
  }

  forget(paneId: string): void {
    this.sinks.delete(paneId)
    this.pending.delete(paneId)
    this.tracks.delete(paneId)
    this.sizes.delete(paneId)
  }

  onExit(cb: (e: PtyExitEvent) => void): () => void {
    this.exitListeners.add(cb)
    return () => this.exitListeners.delete(cb)
  }

  onLoginDetected(cb: (paneId: string) => void): () => void {
    this.loginListeners.add(cb)
    return () => this.loginListeners.delete(cb)
  }

  private track(paneId: string): PaneTrack {
    let t = this.tracks.get(paneId)
    if (!t) {
      t = { lastOutputAt: 0, lastInputAt: 0, approvalAt: 0, tail: '' }
      this.tracks.set(paneId, t)
    }
    return t
  }

  private handleData(paneId: string, data: string): void {
    const sink = this.sinks.get(paneId)
    if (sink) sink(data)
    else {
      const queued = (this.pending.get(paneId) ?? '') + data
      this.pending.set(paneId, queued.slice(-PENDING_MAX))
    }

    const t = this.track(paneId)
    const now = this.now()
    if (now - t.lastInputAt > ECHO_WINDOW_MS) t.lastOutputAt = now

    const text = stripAnsi(data)
    if (!text) return
    const window = t.tail.slice(-200) + text
    t.tail = (t.tail + text).slice(-TAIL_MAX)
    if (APPROVAL_PATTERN.test(window)) t.approvalAt = now
    if (LOGIN_PATTERN.test(window)) this.loginListeners.forEach((cb) => cb(paneId))
  }
}
