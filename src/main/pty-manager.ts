import type { IDisposable, IPty, IPtyForkOptions } from 'node-pty'
import type { PtyExitEvent } from '@shared/ipc-contract'

export type SpawnFn = (file: string, args: string[], options: IPtyForkOptions) => IPty
/** `groupOnly` skips the single-pid fallback, for when the leader pid may be reused. */
export type KillFn = (pid: number, signal: NodeJS.Signals, groupOnly?: boolean) => void

export interface PtyManagerDeps {
  spawn: SpawnFn
  onData: (paneId: string, data: string) => void
  onExit: (event: PtyExitEvent) => void
  /** Defaults to signalling the whole process group, then the pid alone. */
  kill?: KillFn
  /** Output coalescing window. 16 ms keeps 8 busy panes smooth (NFR-1). */
  flushMs?: number
  /** Grace period between SIGHUP and SIGKILL. */
  killGraceMs?: number
}

export interface SpawnRequest {
  paneId: string
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}

export type SpawnResult = { ok: true; pid: number } | { ok: false; error: string }

interface Entry {
  pty: IPty
  buffer: string
  timer: NodeJS.Timeout | null
  subs: IDisposable[]
  exited: Promise<void>
  markExited: () => void
}

const MAX_BUFFER = 256 * 1024

/**
 * node-pty's spawn uses setsid, so each pane's pid leads its own process group.
 * Signalling the group also reaches the tools claude started (MCP servers, shells).
 */
export const killProcessGroup: KillFn = (pid, signal, groupOnly = false) => {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal)
      return
    } catch {
      // Fall through: the group may already be gone while the leader lingers.
    }
  }
  if (groupOnly) return
  try {
    process.kill(pid, signal)
  } catch {
    // Already exited.
  }
}

/** Owns every pane process: paneId → IPty. One pane's failure never touches another. */
export class PtyManager {
  private readonly ptys = new Map<string, Entry>()
  private readonly flushMs: number
  private readonly killGraceMs: number
  private readonly killFn: KillFn

  constructor(private readonly deps: PtyManagerDeps) {
    this.flushMs = deps.flushMs ?? 16
    this.killGraceMs = deps.killGraceMs ?? 2000
    this.killFn = deps.kill ?? killProcessGroup
  }

  get size(): number {
    return this.ptys.size
  }

  has(paneId: string): boolean {
    return this.ptys.has(paneId)
  }

  pids(): number[] {
    return [...this.ptys.values()].map((e) => e.pty.pid)
  }

  create(req: SpawnRequest): SpawnResult {
    // A restart replaces the old process; its late exit event must not reach the pane.
    if (this.ptys.has(req.paneId)) this.kill(req.paneId)

    let pty: IPty
    try {
      pty = this.deps.spawn(req.file, req.args, {
        name: 'xterm-256color',
        cols: req.cols,
        rows: req.rows,
        cwd: req.cwd,
        env: req.env
      })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    let markExited = (): void => {}
    const exited = new Promise<void>((resolve) => (markExited = resolve))
    const entry: Entry = { pty, buffer: '', timer: null, subs: [], exited, markExited }

    entry.subs.push(
      pty.onData((data) => {
        entry.buffer += data
        if (entry.buffer.length >= MAX_BUFFER) this.flush(req.paneId, entry)
        else if (!entry.timer) {
          entry.timer = setTimeout(() => this.flush(req.paneId, entry), this.flushMs)
        }
      }),
      pty.onExit(({ exitCode, signal }) => {
        this.flush(req.paneId, entry)
        entry.markExited()
        if (this.ptys.get(req.paneId) === entry) {
          this.ptys.delete(req.paneId)
          this.dispose(entry)
          this.deps.onExit({ paneId: req.paneId, exitCode, signal: signal ?? null })
        }
      })
    )
    this.ptys.set(req.paneId, entry)
    return { ok: true, pid: pty.pid }
  }

  write(paneId: string, data: string): void {
    const entry = this.ptys.get(paneId)
    if (!entry) return
    try {
      entry.pty.write(data)
    } catch {
      // The process is exiting; its exit event reports the outcome.
    }
  }

  resize(paneId: string, cols: number, rows: number): void {
    const entry = this.ptys.get(paneId)
    if (!entry) return
    try {
      entry.pty.resize(cols, rows)
    } catch {
      // Resizing a pty whose process just died throws; ignore.
    }
  }

  /** Stops a pane: SIGHUP now, SIGKILL after the grace period. Emits no exit event. */
  kill(paneId: string): Promise<void> {
    const entry = this.ptys.get(paneId)
    if (!entry) return Promise.resolve()
    this.ptys.delete(paneId)
    this.dispose(entry)
    return this.terminate(entry)
  }

  /** Used on quit: every process gets SIGHUP, stragglers get SIGKILL after the grace period. */
  async killAll(): Promise<void> {
    const entries = [...this.ptys.values()]
    this.ptys.clear()
    entries.forEach((e) => this.dispose(e))
    await Promise.all(entries.map((e) => this.terminate(e)))
  }

  private terminate(entry: Entry): Promise<void> {
    const pid = entry.pty.pid
    this.killFn(pid, 'SIGHUP')
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.killFn(pid, 'SIGKILL')
        resolve()
      }, this.killGraceMs)
      void entry.exited.then(() => {
        clearTimeout(timer)
        // The leader is gone; make sure nothing it started survives it.
        this.killFn(pid, 'SIGKILL', true)
        resolve()
      })
    })
  }

  private flush(paneId: string, entry: Entry): void {
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    if (!entry.buffer) return
    const data = entry.buffer
    entry.buffer = ''
    if (this.ptys.get(paneId) === entry) this.deps.onData(paneId, data)
  }

  private dispose(entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    // Keep the exit listener's side effect (markExited) alive for terminate(): only data
    // is dropped. node-pty keeps firing onExit on the pty object itself.
    entry.subs[0]?.dispose()
  }
}
