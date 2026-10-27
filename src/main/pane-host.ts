// The GUI's side of the background pty host (ADR 0001): finds or starts the host, speaks its
// protocol and offers main the same create/write/resize/kill surface PtyManager had, plus
// attach. Sockets and process start are injected so it can be tested over a memory stream.
import type { Duplex } from 'node:stream'
import type { MachineTestResult, PtyExitEvent } from '@shared/ipc-contract'
import {
  FrameReader,
  PROTOCOL_VERSION,
  encodeFrame,
  parseWelcome,
  type ClientFrame,
  type HostFrame,
  type HostReply,
  type PaneSummary
} from '../host/protocol'
import type { SpawnRequest, SpawnResult } from '../host/protocol'
import type { SpawnSpec } from './spawn-resolve'

type Request = ClientFrame extends infer F
  ? F extends { id: number }
    ? Omit<F, 'id'>
    : never
  : never

export interface Welcome {
  protocol: number
  appVersion: string
  pid: number
}

/** One authenticated connection to a host. */
export class HostConnection {
  private nextId = 1
  private readonly pending = new Map<number, (r: HostReply) => void>()
  private closed = false

  onData: (paneId: string, data: string, replay: boolean) => void = () => {}
  onExit: (paneId: string, exitCode: number, signal: number | null) => void = () => {}
  onGui: (id: number, action: Record<string, unknown>) => void = () => {}
  onClose: () => void = () => {}

  private constructor(private readonly stream: Duplex) {}

  /** Sends the hello; resolves once the host welcomed this client. */
  static open(
    stream: Duplex,
    token: string,
    appVersion: string,
    role: 'gui' | 'cli' = 'gui',
    timeoutMs = 5000
  ): Promise<{ conn: HostConnection; welcome: Welcome }> {
    const conn = new HostConnection(stream)
    return new Promise((resolve, reject) => {
      let welcomed = false
      const timer = setTimeout(() => {
        stream.destroy()
        reject(new Error('The background host did not answer.'))
      }, timeoutMs)
      const reader = new FrameReader(
        (raw) => {
          if (welcomed) return conn.handle(raw as HostFrame)
          clearTimeout(timer)
          const w = parseWelcome(raw)
          if (!w || w.t === 'refused') {
            stream.destroy()
            reject(
              new Error(`The background host refused the connection (${w?.error ?? 'bad reply'}).`)
            )
            return
          }
          welcomed = true
          resolve({ conn, welcome: { protocol: w.protocol, appVersion: w.appVersion, pid: w.pid } })
        },
        () => stream.destroy()
      )
      stream.setEncoding?.('utf8')
      stream.on('data', (chunk: string | Buffer) => reader.push(String(chunk)))
      stream.on('error', () => {})
      stream.on('close', () => {
        clearTimeout(timer)
        conn.closed = true
        if (!welcomed) reject(new Error('The background host closed the connection.'))
        for (const done of conn.pending.values())
          done({ ok: false, error: 'Host connection closed' })
        conn.pending.clear()
        if (welcomed) conn.onClose()
      })
      stream.write(encodeFrame({ t: 'hello', protocol: PROTOCOL_VERSION, appVersion, token, role }))
    })
  }

  get isClosed(): boolean {
    return this.closed
  }

  request(frame: Request): Promise<HostReply> {
    if (this.closed) return Promise.resolve({ ok: false, error: 'Host connection closed' })
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.stream.write(encodeFrame({ ...frame, id } as ClientFrame))
    })
  }

  send(
    frame: Extract<ClientFrame, { t: 'write' | 'resize' | 'kill' | 'config' | 'guiReply' }>
  ): void {
    if (!this.closed) this.stream.write(encodeFrame(frame))
  }

  close(): void {
    this.stream.end()
  }

  private handle(f: HostFrame): void {
    switch (f.t) {
      case 'reply': {
        const done = this.pending.get(f.id)
        this.pending.delete(f.id)
        done?.(f.reply)
        return
      }
      case 'data':
        return this.onData(f.paneId, f.data, f.replay === true)
      case 'exit':
        return this.onExit(f.paneId, f.exitCode, f.signal)
      case 'gui':
        return this.onGui(f.id, f.action)
    }
  }
}

export interface AttachResult {
  pid: number
  exit: PaneSummary['exit']
}

export type MismatchChoice = 'restart' | 'keep'

export type ProbeResult = MachineTestResult

export interface PaneHostDeps {
  /** Connects to the host socket; rejects when nothing listens. */
  connect: () => Promise<Duplex>
  /** Starts a detached host. */
  start: () => Promise<void>
  readToken: () => Promise<string>
  appVersion: string
  /** `replay` marks a reattached pane's screen, written before its live output. */
  onData: (paneId: string, data: string, replay: boolean) => void
  onExit: (e: PtyExitEvent) => void
  /** A host of another protocol has `live` panes; ask whether to restart them. */
  onMismatch: (info: { appVersion: string; live: number }) => Promise<MismatchChoice>
  /** A `wraithgrid new|split` command for the window; resolves to the reply sent back. */
  onGuiAction?: (action: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** How long to wait for a started host to listen. */
  startTimeoutMs?: number
  /**
   * Set for a machine reached over ssh (H5): what a pane says when the link drops. Its
   * process may still run there, so the exit is marked `disconnected`.
   */
  lostMessage?: string
  /**
   * A remote pane's plan when the link is the Rust host's bridge (ADR 0004 phase 5); null
   * sends the spec for `wraithgrid host-stdio` to resolve.
   */
  plan?: (spec: SpawnSpec) => Record<string, unknown> | null
  /** How long the host may take to answer the hello (longer over ssh). */
  helloTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  log?: (msg: string) => void
}

/** The user chose to leave an older host's agents running; no host is started over it. */
export class OlderHostKept extends Error {}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Main's view of the host: the panes it created or attached in this GUI run. */
export class PaneHost {
  private conn: Promise<HostConnection> | null = null
  /** Panes this GUI run created or attached; told "exited" if the host goes away. */
  private readonly mine = new Set<string>()
  private cliAccess = false
  private welcome: Welcome | null = null

  constructor(private readonly deps: PaneHostDeps) {}

  /** Tells the host whether `wraithgrid` commands may connect (settings.cliAccess). */
  setCliAccess(on: boolean): void {
    this.cliAccess = on
    void this.live()?.then((c) => c.send({ t: 'config', cliAccess: on }))
  }

  /** Starts or joins the host now, so `wraithgrid` commands work before any pane exists. */
  async connect(): Promise<void> {
    try {
      await this.connection()
    } catch (err) {
      this.deps.log?.(`connect: ${(err as Error).message}`)
    }
  }

  async create(req: SpawnRequest): Promise<SpawnResult> {
    let conn: HostConnection
    try {
      conn = await this.connection()
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
    const r = await conn.request({ t: 'create', req })
    if (!r.ok) return { ok: false, error: r.error }
    this.mine.add(req.paneId)
    return { ok: true, pid: 'pid' in r ? r.pid : 0 }
  }

  /** Starts a pane the host's own machine resolves (a remote machine's, through host-stdio). */
  async spawn(spec: SpawnSpec): Promise<SpawnResult> {
    let conn: HostConnection
    try {
      conn = await this.connection()
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
    const plan = this.deps.plan?.(spec)
    const r = await conn.request(plan ? { t: 'plan', plan } : { t: 'spawn', spec })
    if (!r.ok) return { ok: false, error: r.error }
    this.mine.add(spec.paneId)
    return { ok: true, pid: 'pid' in r ? r.pid : 0 }
  }

  /** Reattaches a pane the host still has; null when it has none by that id. */
  async attach(paneId: string, cols: number, rows: number): Promise<AttachResult | null> {
    let conn: HostConnection
    try {
      conn = await this.connection()
    } catch (err) {
      this.deps.log?.(`attach: ${(err as Error).message}`)
      return null
    }
    // The screen arrives as a `replay` data frame ahead of the reply (see wire()).
    const r = await conn.request({ t: 'attach', paneId, cols, rows })
    if (!r.ok || !('attached' in r)) return null
    if (!r.exit) this.mine.add(paneId)
    return { pid: r.pid, exit: r.exit }
  }

  write(paneId: string, data: string): void {
    void this.live()?.then((c) => c.send({ t: 'write', paneId, data }))
  }

  resize(paneId: string, cols: number, rows: number): void {
    void this.live()?.then((c) => c.send({ t: 'resize', paneId, cols, rows }))
  }

  kill(paneId: string): void {
    this.mine.delete(paneId)
    void this.live()?.then((c) => c.send({ t: 'kill', paneId }))
  }

  /** Connects (starting the host if needed) and says which version answered. */
  async probe(): Promise<ProbeResult> {
    try {
      const conn = await this.connection()
      const r = await conn.request({ t: 'list' })
      const live = r.ok && 'panes' in r ? r.panes.filter((p) => !p.exit).length : 0
      return { ok: true, appVersion: this.welcome?.appVersion ?? '', live }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /** Panes still running in the host (any client's); 0 when no host runs. */
  async liveCount(): Promise<number> {
    const conn = await this.existing()
    if (!conn) return 0
    const r = await conn.request({ t: 'list' })
    return r.ok && 'panes' in r ? r.panes.filter((p) => !p.exit).length : 0
  }

  /** Stops every pane and the host itself, if one runs. */
  async stopAll(): Promise<void> {
    const conn = await this.existing()
    if (!conn) return
    this.mine.clear()
    await conn.request({ t: 'shutdown', exit: true })
  }

  /** Leaves the host and its panes running (quit with "keep agents running"). */
  async detach(): Promise<void> {
    const conn = await this.conn?.catch(() => null)
    this.conn = null
    this.mine.clear()
    if (conn) {
      conn.onClose = () => {}
      conn.close()
    }
  }

  /** The open connection, if any, without starting a host. */
  private live(): Promise<HostConnection> | null {
    return this.conn
  }

  /** Connects to a running host without starting one. */
  private async existing(): Promise<HostConnection | null> {
    if (this.conn) {
      try {
        return await this.conn
      } catch {
        return null
      }
    }
    try {
      const conn = await this.dial()
      this.conn ??= Promise.resolve(conn)
      return conn
    } catch {
      return null
    }
  }

  private connection(): Promise<HostConnection> {
    if (!this.conn) {
      this.conn = this.open().catch((err: unknown) => {
        this.conn = null
        throw err
      })
    }
    return this.conn
  }

  private async open(): Promise<HostConnection> {
    try {
      return await this.dial()
    } catch (err) {
      if (err instanceof OlderHostKept) throw err
      // Nothing listens (or an older host was just stopped): start one below.
    }
    await this.deps.start()
    const sleep = this.deps.sleep ?? defaultSleep
    const deadline = Date.now() + (this.deps.startTimeoutMs ?? 10_000)
    let lastError = 'The background host did not start.'
    while (Date.now() < deadline) {
      await sleep(100)
      try {
        return await this.dial()
      } catch (err) {
        if (err instanceof OlderHostKept) throw err
        lastError = (err as Error).message
      }
    }
    throw new Error(lastError)
  }

  private async dial(): Promise<HostConnection> {
    const stream = await this.deps.connect()
    const token = await this.deps.readToken()
    const { conn, welcome } = await HostConnection.open(
      stream,
      token,
      this.deps.appVersion,
      'gui',
      this.deps.helloTimeoutMs
    )
    if (welcome.protocol !== PROTOCOL_VERSION) return this.mismatch(conn, welcome)
    this.welcome = welcome
    return this.wire(conn)
  }

  private async mismatch(conn: HostConnection, welcome: Welcome): Promise<HostConnection> {
    // `list` and `shutdown` keep their shape across versions (protocol.ts).
    const r = await conn.request({ t: 'list' })
    const live = r.ok && 'panes' in r ? r.panes.filter((p) => !p.exit).length : 0
    const choice =
      live === 0 ? 'restart' : await this.deps.onMismatch({ appVersion: welcome.appVersion, live })
    if (choice === 'keep') {
      conn.close()
      throw new OlderHostKept(
        `Agents are running in an older background host (Wraithgrid ${welcome.appVersion}). Quit and stop them to start panes here.`
      )
    }
    const closed = new Promise<void>((resolve) => (conn.onClose = resolve))
    await conn.request({ t: 'shutdown', exit: true })
    await closed
    throw new Error('Stopped an older background host.') // open() starts a new one
  }

  private wire(conn: HostConnection): HostConnection {
    conn.send({ t: 'config', cliAccess: this.cliAccess })
    conn.onGui = (id, action) => {
      const run =
        this.deps.onGuiAction ?? (() => Promise.resolve({ ok: false, error: 'No window' }))
      void run(action)
        .catch((err: Error) => ({ ok: false, error: err.message }))
        .then((reply) => conn.send({ t: 'guiReply', id, reply }))
    }
    conn.onData = (paneId, data, replay) => this.deps.onData(paneId, data, replay)
    conn.onExit = (paneId, exitCode, signal) => {
      this.mine.delete(paneId)
      this.deps.onExit({ paneId, exitCode, signal })
    }
    conn.onClose = () => {
      this.conn = null
      // The host died under us: every pane it ran for this window is gone.
      const lost = [...this.mine]
      this.mine.clear()
      const remote = this.deps.lostMessage
      for (const paneId of lost) {
        this.deps.onExit({
          paneId,
          exitCode: -1,
          signal: null,
          error: remote ?? 'The background host stopped.',
          ...(remote ? { disconnected: true } : {})
        })
      }
    }
    return conn
  }
}
