// Runs the chat panes' CLI processes (ADR 0002): one headless process per pane, fed JSON
// lines on stdin, its stdout decoded by the CLI's adapter into ChatEvents for the window.
// They live in main, not the pty host, so they stop when Wraithgrid quits; the next start
// resumes the conversation by its session id.
import type { Readable, Writable } from 'node:stream'
import type { ApprovalDecision, ChatAnswers, ChatEvent, ChatImage, ChatMode } from '@shared/chat'
import type { ChatAdapter } from './adapter'

export interface ChatChild {
  pid: number | undefined
  stdin: Writable
  stdout: Readable
  stderr: Readable
  kill(signal?: NodeJS.Signals): boolean
  once(event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  once(event: 'error', cb: (err: Error) => void): unknown
}

export interface ChatLaunch {
  file: string
  /** A string is a ready Windows command line (a `.cmd` CLI under cmd.exe). */
  args: string[] | string
  cwd: string
  env: Record<string, string>
}

export interface ChatSessionsDeps {
  spawn(launch: ChatLaunch): ChatChild
  emit(paneId: string, event: ChatEvent): void
  /** Ends a process that ignored the polite stop (Windows: the whole tree). */
  forceKill?(pid: number): void
  stopGraceMs?: number
}

interface Session {
  child: ChatChild
  adapter: ChatAdapter
  /** Set once stop() was asked, so the exit is not reported as a failure. */
  stopping: boolean
  stderr: string
  /** Turns sent and not finished: a message sent while one runs is queued by the CLI. */
  turns: number
  /** Stop was asked: the next turn end clears the queue too. */
  interrupted: boolean
  /** Background work was running when last heard of: it dies with the process. */
  background: boolean
}

const LINE_MAX = 16_000_000
const STDERR_KEEP = 2000
const SIGNALS: Partial<Record<NodeJS.Signals, number>> = { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 }

export class ChatSessions {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly deps: ChatSessionsDeps) {}

  has(paneId: string): boolean {
    return this.sessions.has(paneId)
  }

  get count(): number {
    return this.sessions.size
  }

  start(paneId: string, launch: ChatLaunch, adapter: ChatAdapter): { pid: number | null } {
    const child = this.deps.spawn(launch)
    const s: Session = {
      child,
      adapter,
      stopping: false,
      stderr: '',
      turns: 0,
      interrupted: false,
      background: false
    }
    this.sessions.set(paneId, s)
    const emit = (e: ChatEvent): void => this.deps.emit(paneId, e)

    let buf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) this.handleLine(paneId, s, line)
      }
      // A line this long is not a protocol line: drop it rather than grow without end.
      if (buf.length > LINE_MAX) buf = ''
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      s.stderr = (s.stderr + chunk).slice(-STDERR_KEEP)
    })
    // A write after the process died must not throw in main.
    child.stdin.on('error', () => {})

    let ended = false
    const end = (code: number | null, signal: NodeJS.Signals | null, err?: string): void => {
      if (ended) return
      ended = true
      if (this.sessions.get(paneId) === s) this.sessions.delete(paneId)
      if (s.background) emit({ t: 'background', tasks: [] })
      // A stop the window asked for (restart, view switch, close): a new process may
      // already run for the pane, so this one's exit is not news.
      if (s.stopping) return
      const failed = code !== 0
      const lastErr = s.stderr.trim().split('\n').filter(Boolean).pop() ?? null
      emit({ t: 'busy', busy: false })
      emit({
        t: 'exit',
        code,
        signal: signal ? (SIGNALS[signal] ?? null) : null,
        error: err ?? (failed ? lastErr : null)
      })
    }
    child.once('error', (e) => end(null, null, e.message))
    child.once('exit', (code, signal) => end(code, signal))

    for (const line of adapter.hello()) this.write(s, line)
    return { pid: child.pid ?? null }
  }

  private handleLine(paneId: string, s: Session, line: string): void {
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      return // Not ours: a stray log line.
    }
    const { events, replies } = s.adapter.decode(msg)
    for (const r of replies) this.write(s, r)
    for (const e of events) {
      if (e.t === 'background') s.background = e.tasks.length > 0
      if (e.t === 'busy' && e.busy) {
        // A turn the CLI started on its own (background work ended, #39); one already
        // running covers it.
        if (s.turns > 0) continue
        s.turns = 1
      }
      if (e.t === 'busy' && !e.busy) {
        // An earlier turn ending must not mark the chat idle while a queued one runs.
        s.turns = s.interrupted ? 0 : Math.max(0, s.turns - 1)
        s.interrupted = false
        if (s.turns > 0) continue
      }
      this.deps.emit(paneId, e)
    }
  }

  private write(s: Session, msg: unknown): void {
    if (msg === null || msg === undefined) return
    if (s.child.stdin.writable) s.child.stdin.write(`${JSON.stringify(msg)}\n`)
  }

  send(paneId: string, text: string, images: ChatImage[]): boolean {
    const s = this.sessions.get(paneId)
    if (!s) return false
    this.write(s, s.adapter.user(text, images))
    s.turns++
    this.deps.emit(paneId, { t: 'busy', busy: true })
    return true
  }

  approve(
    paneId: string,
    reqId: string,
    decision: ApprovalDecision,
    answers?: ChatAnswers
  ): boolean {
    const s = this.sessions.get(paneId)
    const line = s?.adapter.answer(reqId, decision, answers)
    if (!s || !line) return false
    this.write(s, line)
    this.deps.emit(paneId, { t: 'approvalDone', reqId, decision, ...(answers ? { answers } : {}) })
    return true
  }

  /** Switches the running session's model; false when the CLI can't (restart it instead). */
  setModel(paneId: string, model: string): boolean {
    const s = this.sessions.get(paneId)
    const line = s?.adapter.setModel(model)
    if (!s || !line) return false
    this.write(s, line)
    return true
  }

  /** Switches the permission mode live; false when the CLI can't. */
  setMode(paneId: string, mode: ChatMode): boolean {
    const s = this.sessions.get(paneId)
    const line = s?.adapter.setMode?.(mode)
    if (!s || !line) return false
    this.write(s, line)
    return true
  }

  /** An event about a running chat from outside its pipe (its CLI's model list). */
  announce(paneId: string, e: ChatEvent): void {
    if (this.sessions.has(paneId)) this.deps.emit(paneId, e)
  }

  interrupt(paneId: string): void {
    const s = this.sessions.get(paneId)
    if (!s) return
    s.interrupted = true
    const line = s.adapter.interrupt()
    if (line) this.write(s, line)
  }

  /** Stops the process: closes stdin, then a signal, then a forced kill after the grace time. */
  stop(paneId: string): Promise<void> {
    const s = this.sessions.get(paneId)
    if (!s) return Promise.resolve()
    s.stopping = true
    this.sessions.delete(paneId)
    return new Promise((resolve) => {
      const grace = this.deps.stopGraceMs ?? 2000
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        if (s.child.pid) this.deps.forceKill?.(s.child.pid)
        s.child.kill('SIGKILL')
        finish()
      }, grace)
      s.child.once('exit', finish)
      s.child.stdin.end()
      s.child.kill('SIGTERM')
    })
  }

  stopAll(): Promise<void> {
    return Promise.all([...this.sessions.keys()].map((id) => this.stop(id))).then(() => undefined)
  }
}
