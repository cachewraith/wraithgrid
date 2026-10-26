// The pty host's core, free of sockets and process setup so it can be tested over an
// in-memory stream: owns every pane process and its screen, and serves any number of
// clients. A client sees a pane's output only after it created or attached that pane.
// `wraithgrid` commands (role `cli`) may read, type into and wait on panes, and ask the
// window for new ones, only while the GUI has command-line access turned on.
import { timingSafeEqual } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { ECHO_WINDOW_MS, RUNNING_WINDOW_MS } from '@shared/activity'
import {
  FrameReader,
  PROTOCOL_VERSION,
  chunkReplay,
  clientFrame,
  encodeFrame,
  type ClientFrame,
  type HostFrame,
  type HostReply,
  type PaneState,
  type PaneSummary
} from './protocol'
import { PtyManager, type KillPolicy, type SpawnFn } from './pty-manager'
import { headlessScreen, type Screen, type ScreenFactory } from './screen'

export interface HostServerDeps {
  spawn: SpawnFn
  token: string
  appVersion: string
  pid: number
  /** No live pane and no client for this long: the host exits. */
  idleMs?: number
  onIdle: () => void
  /** A `shutdown` with `exit` stopped every pane. */
  onShutdown: () => void
  screen?: ScreenFactory
  killPolicy?: KillPolicy
  killGraceMs?: number
  flushMs?: number
  helloTimeoutMs?: number
  /** How often pending `wait`s are checked. */
  waitTickMs?: number
  /** How long a relayed window command may take. */
  guiTimeoutMs?: number
  now?: () => number
  log?: (msg: string) => void
}

interface PaneEntry {
  pid: number
  screen: Screen
  exit: PaneSummary['exit']
  approval: RegExp | null
  lastOutputAt: number
  lastInputAt: number
  /** The window's size for this pane, restored when a `wraithgrid attach` leaves. */
  guiSize: { cols: number; rows: number }
}

interface Waiter {
  paneId: string
  until: PaneState
  quietMs: number
  deadline: number
  /** When the pane was first seen idle in a row (for `quietMs`). */
  idleSince: number | null
  done: (reply: HostReply) => void
  /** Who waits: gone, the wait is dropped rather than polled to its timeout (#140). */
  client: Client
}

/** Typed input with no answer yet: the CLI is about to work (a `wait --until idle` right after `send`). */
const PENDING_INPUT_MS = 10_000
/** Frames a `wraithgrid` command may send. */
const CLI_FRAMES = new Set([
  'hello',
  'list',
  'read',
  'wait',
  'write',
  'gui',
  'shutdown',
  'attach',
  'resize'
])
const GUI_ONLY = 'Only the Wraithgrid window may do that.'

/** A client that stops reading is dropped before its backlog fills the host's memory. */
const MAX_BACKLOG = 64 * 1024 * 1024

class Client {
  authed = false
  role: 'gui' | 'cli' = 'gui'
  readonly attached = new Set<string>()
  /** Output that arrived while this client's snapshot of the pane was being taken. */
  readonly catchUp = new Map<string, string[]>()

  constructor(readonly stream: Duplex) {}

  send(frame: HostFrame): void {
    if (this.stream.destroyed) return
    if (this.stream.writableLength > MAX_BACKLOG) {
      this.stream.destroy()
      return
    }
    this.stream.write(encodeFrame(frame))
  }
}

export class HostServer {
  private readonly ptys: PtyManager
  private readonly panes = new Map<string, PaneEntry>()
  private readonly clients = new Set<Client>()
  private readonly screen: ScreenFactory
  private readonly token: Buffer
  private idleTimer: NodeJS.Timeout | null = null
  private stopping = false
  private cliAccess = false
  private readonly waiters = new Set<Waiter>()
  private waitTimer: NodeJS.Timeout | null = null
  private nextRelay = 1
  private readonly relays = new Map<
    number,
    { gui: Client; done: (reply: HostReply) => void; timer: NodeJS.Timeout }
  >()
  private readonly now: () => number

  constructor(private readonly deps: HostServerDeps) {
    this.screen = deps.screen ?? headlessScreen
    this.token = Buffer.from(deps.token)
    this.now = deps.now ?? Date.now
    this.ptys = new PtyManager({
      spawn: deps.spawn,
      killPolicy: deps.killPolicy,
      killGraceMs: deps.killGraceMs,
      flushMs: deps.flushMs,
      onData: (paneId, data) => this.onData(paneId, data),
      onExit: (e) => this.onExit(e.paneId, e.exitCode, e.signal)
    })
    this.checkIdle()
  }

  get liveCount(): number {
    return this.ptys.size
  }

  accept(stream: Duplex): void {
    const client = new Client(stream)
    this.clients.add(client)
    this.checkIdle()
    stream.setEncoding?.('utf8')
    const helloTimer = setTimeout(() => {
      if (!client.authed) stream.destroy()
    }, this.deps.helloTimeoutMs ?? 5000)
    const reader = new FrameReader(
      (raw) => void this.handle(client, raw),
      (err) => {
        this.deps.log?.(`client dropped: ${err}`)
        stream.destroy()
      }
    )
    stream.on('data', (chunk: string | Buffer) => reader.push(String(chunk)))
    stream.on('error', () => {})
    stream.on('close', () => {
      clearTimeout(helloTimer)
      this.clients.delete(client)
      for (const w of this.waiters) if (w.client === client) this.waiters.delete(w)
      // A terminal attach resized its panes; give them back the window's size.
      if (client.role === 'cli') {
        for (const paneId of client.attached) {
          const e = this.panes.get(paneId)
          if (!e || e.exit) continue
          this.ptys.resize(paneId, e.guiSize.cols, e.guiSize.rows)
          e.screen.resize(e.guiSize.cols, e.guiSize.rows)
        }
      }
      for (const [id, r] of this.relays) {
        if (r.gui !== client) continue
        clearTimeout(r.timer)
        this.relays.delete(id)
        r.done({ ok: false, error: 'The Wraithgrid window closed.' })
      }
      this.checkIdle()
    })
  }

  /** Stops every pane (signal, quit). */
  async stopAll(): Promise<void> {
    this.stopping = true
    await this.ptys.killAll()
    for (const e of this.panes.values()) e.screen.dispose()
    this.panes.clear()
  }

  private async handle(client: Client, raw: unknown): Promise<void> {
    const parsed = clientFrame.safeParse(raw)
    if (!parsed.success) {
      this.deps.log?.('client dropped: invalid frame')
      client.stream.destroy()
      return
    }
    const f = parsed.data
    if (!client.authed) {
      if (f.t !== 'hello' || !this.tokenMatches(f.token)) {
        client.send({ t: 'refused', error: 'bad token' })
        client.stream.end()
        return
      }
      if (f.role === 'cli' && !this.cliAccess) {
        client.send({
          t: 'refused',
          error: 'Command-line access is off. Turn it on in Wraithgrid: Settings → Command line.'
        })
        client.stream.end()
        return
      }
      client.authed = true
      client.role = f.role
      client.send({
        t: 'welcome',
        protocol: PROTOCOL_VERSION,
        appVersion: this.deps.appVersion,
        pid: this.deps.pid
      })
      return
    }
    if (client.role === 'cli' && !CLI_FRAMES.has(f.t)) {
      if ('id' in f) this.reply(client, f.id, { ok: false, error: GUI_ONLY })
      return
    }
    switch (f.t) {
      case 'hello':
        return
      case 'config':
        this.cliAccess = f.cliAccess
        return
      case 'guiReply': {
        const r = this.relays.get(f.id)
        if (!r || r.gui !== client) return
        clearTimeout(r.timer)
        this.relays.delete(f.id)
        const reply = f.reply
        return r.done(
          reply.ok === true
            ? { ok: true, result: reply }
            : { ok: false, error: String(reply.error ?? 'The window refused it.') }
        )
      }
      case 'write': {
        const entry = this.panes.get(f.paneId)
        if (entry) entry.lastInputAt = this.now()
        return this.ptys.write(f.paneId, f.data)
      }
      case 'resize': {
        const e = this.panes.get(f.paneId)
        if (!e || e.exit) return
        if (client.role === 'gui') e.guiSize = { cols: f.cols, rows: f.rows }
        this.ptys.resize(f.paneId, f.cols, f.rows)
        e.screen.resize(f.cols, f.rows)
        return
      }
      case 'kill':
        this.drop(f.paneId)
        await this.ptys.kill(f.paneId)
        return this.checkIdle()
      default:
        return this.reply(client, f.id, await this.request(client, f))
    }
  }

  private async request(
    client: Client,
    f: Exclude<ClientFrame, { t: 'hello' | 'write' | 'resize' | 'kill' | 'config' | 'guiReply' }>
  ): Promise<HostReply | null> {
    switch (f.t) {
      case 'spawn':
      case 'plan':
        return { ok: false, error: 'Remote panes are started through wraithgrid host-stdio.' }
      case 'create': {
        if (this.stopping) return { ok: false, error: 'The background host is stopping.' }
        this.drop(f.req.paneId)
        const res = this.ptys.create(f.req)
        if (!res.ok) return res
        let approval: RegExp | null = null
        try {
          approval = f.req.approval ? new RegExp(f.req.approval, 'i') : null
        } catch {
          // A pattern this runtime cannot compile only loses `blocked`.
        }
        this.panes.set(f.req.paneId, {
          pid: res.pid,
          screen: this.screen(f.req.cols, f.req.rows),
          exit: null,
          approval,
          lastOutputAt: 0,
          lastInputAt: 0,
          guiSize: { cols: f.req.cols, rows: f.req.rows }
        })
        for (const c of this.clients) c.attached.delete(f.req.paneId)
        client.attached.add(f.req.paneId)
        this.checkIdle()
        return res
      }
      case 'attach': {
        const entry = this.panes.get(f.paneId)
        if (!entry) return { ok: false, error: 'Not running', missing: true }
        if (!entry.exit) {
          if (client.role === 'gui') entry.guiSize = { cols: f.cols, rows: f.rows }
          this.ptys.resize(f.paneId, f.cols, f.rows)
          entry.screen.resize(f.cols, f.rows)
        }
        // Output from here on is not in the snapshot; hold it for this client until the
        // snapshot is sent, so nothing is lost or shown twice.
        const held: string[] = []
        client.catchUp.set(f.paneId, held)
        const snapshot = await entry.screen.serialize()
        client.catchUp.delete(f.paneId)
        const exit = entry.exit
        // A command-line attach must not use up the exit the window has not shown yet.
        if (exit && client.role === 'gui') this.drop(f.paneId)
        else if (!exit) client.attached.add(f.paneId)
        // In stream order: the screen, then what arrived while it was taken, then the reply.
        // In pieces, so a big screen never exceeds a client's MAX_FRAME (#134).
        for (const part of chunkReplay(snapshot))
          client.send({ t: 'data', paneId: f.paneId, data: part, replay: true })
        for (const data of held) client.send({ t: 'data', paneId: f.paneId, data })
        return { ok: true, pid: entry.pid, attached: true, exit }
      }
      case 'list':
        return {
          ok: true,
          panes: await Promise.all(
            [...this.panes].map(async ([paneId, e]) => ({
              paneId,
              pid: e.pid,
              exit: e.exit,
              state: await this.state(e)
            }))
          )
        }
      case 'read': {
        const entry = this.panes.get(f.paneId)
        if (!entry) return { ok: false, error: `No pane ${f.paneId} is running.`, missing: true }
        return { ok: true, text: await entry.screen.text(f.lines) }
      }
      case 'wait': {
        if (!this.panes.has(f.paneId))
          return { ok: false, error: `No pane ${f.paneId} is running.`, missing: true }
        return new Promise<HostReply>((done) => {
          this.waiters.add({
            paneId: f.paneId,
            until: f.until,
            quietMs: f.quietMs,
            deadline: this.now() + f.timeoutMs,
            idleSince: null,
            done,
            client
          })
          this.tickWaits()
        })
      }
      case 'gui': {
        const gui = [...this.clients].reverse().find((c) => c.authed && c.role === 'gui')
        if (!gui) return { ok: false, error: 'Wraithgrid is not open. Start it to add panes.' }
        const id = this.nextRelay++
        return new Promise<HostReply>((done) => {
          const timer = setTimeout(() => {
            this.relays.delete(id)
            done({ ok: false, error: 'The Wraithgrid window did not answer.' })
          }, this.deps.guiTimeoutMs ?? 30_000)
          this.relays.set(id, { gui, done, timer })
          gui.send({ t: 'gui', id, action: f.action })
        })
      }
      case 'shutdown':
        await this.stopAll()
        this.reply(client, f.id, { ok: true })
        if (f.exit) this.deps.onShutdown()
        else this.stopping = false
        return null
    }
  }

  private reply(client: Client, id: number, reply: HostReply | null): void {
    if (reply) client.send({ t: 'reply', id, reply })
  }

  private onData(paneId: string, data: string): void {
    const entry = this.panes.get(paneId)
    if (!entry) return
    entry.screen.write(data)
    const now = this.now()
    if (now - entry.lastInputAt > ECHO_WINDOW_MS) entry.lastOutputAt = now
    for (const c of this.clients) {
      // Held while this client's snapshot is taken, even when it was attached already (the
      // window reattaching after a reload): sent now, it could also be in the snapshot (#140).
      const held = c.catchUp.get(paneId)
      if (held) held.push(data)
      else if (c.attached.has(paneId)) c.send({ t: 'data', paneId, data })
    }
  }

  private onExit(paneId: string, exitCode: number, signal: number | null): void {
    const entry = this.panes.get(paneId)
    if (!entry) return
    for (const w of this.waiters) {
      if (w.paneId !== paneId) continue
      this.waiters.delete(w)
      w.done(
        w.until === 'exited'
          ? { ok: true, state: 'exited' }
          : { ok: false, error: `The pane exited (code ${exitCode}).` }
      )
    }
    const watchers = [...this.clients].filter((c) => c.attached.has(paneId))
    for (const c of watchers) c.send({ t: 'exit', paneId, exitCode, signal })
    if (watchers.some((c) => c.role === 'gui')) this.drop(paneId)
    else {
      // No window saw it end: keep the screen and the code for the next attach.
      entry.exit = { exitCode, signal }
      for (const c of watchers) c.attached.delete(paneId)
    }
    this.checkIdle()
  }

  private drop(paneId: string): void {
    const entry = this.panes.get(paneId)
    if (!entry) return
    this.panes.delete(paneId)
    entry.screen.dispose()
    for (const c of this.clients) c.attached.delete(paneId)
  }

  /** What a pane is doing, read the way the window reads it, plus its screen for `blocked`. */
  private async state(e: PaneEntry): Promise<PaneState> {
    if (e.exit) return 'exited'
    if (e.approval && e.approval.test(await e.screen.text())) return 'blocked'
    const now = this.now()
    if (e.lastInputAt > e.lastOutputAt && now - e.lastInputAt < PENDING_INPUT_MS) return 'running'
    return now - e.lastOutputAt < RUNNING_WINDOW_MS ? 'running' : 'idle'
  }

  private tickWaits(): void {
    if (this.waitTimer || this.waiters.size === 0) return
    this.waitTimer = setTimeout(() => {
      this.waitTimer = null
      void this.checkWaits().finally(() => this.tickWaits())
    }, this.deps.waitTickMs ?? 200)
  }

  private async checkWaits(): Promise<void> {
    for (const w of [...this.waiters]) {
      if (!this.waiters.has(w)) continue // Its client left during an earlier await.
      const entry = this.panes.get(w.paneId)
      if (!entry) {
        this.waiters.delete(w)
        w.done({ ok: false, error: `Pane ${w.paneId} is gone.` })
        continue
      }
      const state = await this.state(entry)
      // Read after the state: a clock read before the await could predate the idle it saw.
      const now = this.now()
      let met = state === w.until
      if (w.until === 'idle') {
        w.idleSince = state === 'idle' ? (w.idleSince ?? now) : null
        met = w.idleSince !== null && now - w.idleSince >= w.quietMs
      }
      if (met) {
        this.waiters.delete(w)
        w.done({ ok: true, state })
      } else if (now >= w.deadline) {
        this.waiters.delete(w)
        w.done({ ok: false, error: `Timed out; the pane is ${state}.` })
      }
    }
  }

  private tokenMatches(token: string): boolean {
    const given = Buffer.from(token)
    return given.length === this.token.length && timingSafeEqual(given, this.token)
  }

  private checkIdle(): void {
    const idle = this.clients.size === 0 && this.ptys.size === 0
    if (!idle) {
      if (this.idleTimer) clearTimeout(this.idleTimer)
      this.idleTimer = null
      return
    }
    if (this.idleTimer) return
    this.idleTimer = setTimeout(
      () => {
        this.idleTimer = null
        if (this.clients.size === 0 && this.ptys.size === 0) this.deps.onIdle()
      },
      this.deps.idleMs ?? 10 * 60_000
    )
    this.idleTimer.unref?.()
  }
}
