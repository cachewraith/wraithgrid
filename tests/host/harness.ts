// Starts the Rust host (host-rs/target/release/wraithgrid-host) on a temporary socket and
// talks NDJSON to it (ADR 0004 §6). The Node host it was compared with went in phase 4b.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Terminal } from '@xterm/headless'

export const ROOT = path.resolve(__dirname, '../..')
export const RUST_BIN = path.join(ROOT, 'host-rs/target/release/wraithgrid-host')
export const APP_VERSION = '9.9.9-parity'

export type Kind = 'rust'

export interface Frame {
  t: string
  [k: string]: unknown
}

export interface Paths {
  dir: string
  socket: string
  token: string
  lock: string
  log: string
}

export class HostProcess {
  constructor(
    readonly kind: Kind,
    readonly proc: ChildProcess,
    readonly paths: Paths,
    readonly token: string
  ) {}

  exited(): Promise<number | null> {
    if (this.proc.exitCode !== null) return Promise.resolve(this.proc.exitCode)
    return new Promise((r) => this.proc.once('exit', (code) => r(code)))
  }

  async stop(): Promise<void> {
    if (this.proc.exitCode === null && this.proc.signalCode === null) this.proc.kill('SIGTERM')
    await Promise.race([this.exited(), sleep(4000)])
    if (this.proc.exitCode === null) this.proc.kill('SIGKILL')
    fs.rmSync(path.dirname(this.paths.dir), { recursive: true, force: true })
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function until<T>(
  f: () => T | Promise<T>,
  ms = 5000,
  what = 'condition'
): Promise<NonNullable<T>> {
  const end = Date.now() + ms
  for (;;) {
    const v = await f()
    if (v) return v as NonNullable<T>
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleep(25)
  }
}

export async function startHost(kind: Kind): Promise<HostProcess> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `wgp-${kind}-`))
  const dir = path.join(base, 'h')
  const paths: Paths = {
    dir,
    socket: path.join(dir, 'host.sock'),
    token: path.join(dir, 'host.token'),
    lock: path.join(dir, 'host.lock'),
    log: path.join(base, 'host.log')
  }
  const out = fs.openSync(paths.log, 'a')
  const env = {
    ...process.env,
    WRAITHGRID_HOST: JSON.stringify({ paths, appVersion: APP_VERSION })
  }
  const proc = spawn(RUST_BIN, [], { env, stdio: ['ignore', out, out] })
  fs.closeSync(out)
  await until(
    () => fs.existsSync(paths.token) && fs.existsSync(paths.socket),
    10_000,
    `${kind} host to listen`
  )
  return new HostProcess(kind, proc, paths, fs.readFileSync(paths.token, 'utf8'))
}

/** One connection: frames in arrival order, replies by id, output per pane. */
export class Client {
  readonly frames: Frame[] = []
  readonly output = new Map<string, string>()
  /** The longest line (frame) received, in characters: clients drop frames over MAX_FRAME. */
  maxLine = 0
  closed = false
  private buf = ''
  private nextId = 1
  private readonly waiting = new Map<number, (reply: Record<string, unknown>) => void>()

  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8')
    sock.on('data', (chunk: string) => {
      this.buf += chunk
      let nl: number
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl)
        this.buf = this.buf.slice(nl + 1)
        if (!line) continue
        this.maxLine = Math.max(this.maxLine, line.length)
        const f = JSON.parse(line) as Frame
        this.frames.push(f)
        if (f.t === 'data') {
          const id = f.paneId as string
          this.output.set(id, (this.output.get(id) ?? '') + (f.data as string))
        }
        if (f.t === 'reply') {
          const done = this.waiting.get(f.id as number)
          this.waiting.delete(f.id as number)
          done?.(f.reply as Record<string, unknown>)
        }
      }
    })
    sock.on('close', () => (this.closed = true))
    sock.on('error', () => {})
  }

  static connect(host: HostProcess): Promise<Client> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(host.paths.socket)
      sock.once('connect', () => resolve(new Client(sock)))
      sock.once('error', reject)
    })
  }

  static async open(host: HostProcess, role: 'gui' | 'cli' = 'gui'): Promise<Client> {
    const c = await Client.connect(host)
    c.send({ t: 'hello', protocol: 1, appVersion: '1.0.0', token: host.token, role })
    const first = await until(() => c.frames[0], 5000, 'welcome')
    if (first.t !== 'welcome') throw new Error(`refused: ${JSON.stringify(first)}`)
    return c
  }

  send(frame: Record<string, unknown>): void {
    this.sock.write(JSON.stringify(frame) + '\n')
  }

  raw(line: string): void {
    this.sock.write(line)
  }

  request(frame: Record<string, unknown>, ms = 10_000): Promise<Record<string, unknown>> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${frame.t}`)), ms)
      this.waiting.set(id, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      this.send({ ...frame, id })
    })
  }

  close(): void {
    this.sock.destroy()
  }

  /** Waits until `pred` holds for one of the frames received so far. */
  frame(pred: (f: Frame) => boolean, ms = 5000): Promise<Frame> {
    return until(() => this.frames.find(pred), ms, 'frame')
  }
}

/** A pane request: the given shell script under /bin/sh, in a small fixed environment. */
export function shPane(
  paneId: string,
  script: string,
  size = { cols: 40, rows: 12 },
  extraEnv: Record<string, string> = {}
): Record<string, unknown> {
  return {
    t: 'create',
    req: {
      paneId,
      file: '/bin/sh',
      args: ['-c', script],
      cwd: os.tmpdir(),
      env: { PATH: '/usr/bin:/bin', HOME: os.tmpdir(), LANG: 'C.UTF-8', ...extraEnv },
      ...size
    }
  }
}

/** Everything about a drawn screen that a user could see, for cell-by-cell comparison. */
export interface Drawn {
  buffer: string
  cursor: [number, number]
  lines: string[]
  modes: Record<string, unknown>
}

/** xterm's colour modes: palette 0–15 drawn as `38;5;N` look the same as the 16-colour codes. */
const P16 = 16777216
const P256 = 33554432
const colour = (mode: number, value: number): [number, number] =>
  mode === P256 && value < 16 ? [P16, value] : [mode, value]

export function draw(data: string, cols: number, rows: number): Promise<Drawn> {
  const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true })
  return new Promise((resolve) => {
    term.write(data, () => {
      const buf = term.buffer.active
      const lines: string[] = []
      const blank: boolean[] = []
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y)
        if (!line) continue
        const cells: string[] = []
        let styled = false
        for (let x = 0; x < cols; x++) {
          const c = line.getCell(x)
          if (!c) continue
          const style = [
            ...colour(c.getFgColorMode(), c.getFgColor()),
            ...colour(c.getBgColorMode(), c.getBgColor()),
            c.isBold(),
            c.isDim(),
            c.isItalic(),
            c.isUnderline(),
            c.isInverse()
          ]
          if (!c.isAttributeDefault()) styled = true
          cells.push(`${c.getChars() || ' '}|${c.getWidth()}|${style.join('.')}`)
        }
        lines.push(`${line.isWrapped ? 'w' : '-'} ${cells.join(' ')}`)
        blank.push(!styled && line.translateToString(true) === '')
      }
      // Trailing untouched rows are the same blank in every buffer: compare what was drawn.
      while (lines.length && blank[lines.length - 1]) lines.pop()
      resolve({
        buffer: buf.type,
        cursor: [buf.cursorX, buf.cursorY],
        lines,
        modes: {
          bracketedPaste: term.modes.bracketedPasteMode,
          applicationCursorKeys: term.modes.applicationCursorKeysMode,
          applicationKeypad: term.modes.applicationKeypadMode,
          mouseTracking: term.modes.mouseTrackingMode
        }
      })
      term.dispose()
    })
  })
}
