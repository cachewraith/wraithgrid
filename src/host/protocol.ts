// Wire format between the pty host and its clients (the GUI and the `wraithgrid` CLI):
// newline-delimited JSON over any duplex stream, every frame checked with zod on arrival.
// `hello`, `welcome` and `shutdown` must keep their shape across protocol versions, so an
// old host can always be told to stop by a newer client (ADR 0001 §5).
import { z } from 'zod'
import { idSchema as paneId } from '@shared/schema'

/** Bump on any change a client of the previous version would not understand. */
export const PROTOCOL_VERSION = 1

const id = z.number().int().nonnegative()
const dim = z.number().int().min(1).max(1000)

export const spawnRequestSchema = z.object({
  paneId,
  file: z.string().min(1).max(4096),
  args: z.union([z.array(z.string().max(32_000)).max(64), z.string().max(32_000)]),
  cwd: z.string().min(1).max(4096),
  env: z.record(z.string(), z.string()),
  cols: dim,
  rows: dim,
  /** The pane CLI's "needs approval" output as a RegExp source (case-insensitive); none for a shell. */
  approval: z.string().max(2000).optional()
})

export const PANE_STATES = ['running', 'idle', 'blocked', 'exited'] as const
export type PaneState = (typeof PANE_STATES)[number]

/** What a `wraithgrid` command asks the window to do; checked again by the GUI. */
const guiAction = z.record(z.string(), z.unknown())

export const clientFrame = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    protocol: z.number().int(),
    appVersion: z.string().max(64),
    token: z.string().max(256),
    /** A `wraithgrid` command is refused unless the GUI turned command-line access on. */
    role: z.enum(['gui', 'cli']).default('gui')
  }),
  z.object({ t: z.literal('create'), id, req: spawnRequestSchema }),
  /**
   * A pane to resolve and start on the host's machine (H5): `wraithgrid host-stdio` turns it
   * into a `create` there. A host reached directly refuses it.
   */
  z.object({ t: z.literal('spawn'), id, spec: z.record(z.string(), z.unknown()) }),
  /** The same for the Rust host's bridge (`wraithgrid-host stdio`): a remote-plan.ts plan. */
  z.object({ t: z.literal('plan'), id, plan: z.record(z.string(), z.unknown()) }),
  z.object({ t: z.literal('attach'), id, paneId, cols: dim, rows: dim }),
  z.object({ t: z.literal('list'), id }),
  z.object({ t: z.literal('write'), paneId, data: z.string().max(1_000_000) }),
  z.object({ t: z.literal('resize'), paneId, cols: dim, rows: dim }),
  z.object({ t: z.literal('kill'), paneId }),
  /** Stops every pane; with `exit` the host also quits once they are gone. */
  z.object({ t: z.literal('shutdown'), id, exit: z.boolean() }),
  /** Screen text: the visible rows, or the last `lines` including scrollback. */
  z.object({
    t: z.literal('read'),
    id,
    paneId,
    lines: z.number().int().min(1).max(100_000).optional()
  }),
  /** Resolves once the pane is in `until` (for `quietMs` when idle), or after `timeoutMs`. */
  z.object({
    t: z.literal('wait'),
    id,
    paneId,
    until: z.enum(PANE_STATES),
    quietMs: z.number().int().min(0).max(600_000).default(1500),
    timeoutMs: z.number().int().min(1).max(86_400_000)
  }),
  /** A command for the window (new pane, split), relayed to the GUI client. */
  z.object({ t: z.literal('gui'), id, action: guiAction }),
  /** The GUI's answer to a relayed `gui` frame. */
  z.object({ t: z.literal('guiReply'), id, reply: z.record(z.string(), z.unknown()) }),
  /** GUI settings the host enforces. */
  z.object({ t: z.literal('config'), cliAccess: z.boolean() })
])
export type ClientFrame = z.infer<typeof clientFrame>

export interface PaneSummary {
  paneId: string
  pid: number
  /** Set when the process ended while no client was attached. */
  exit: { exitCode: number; signal: number | null } | null
  state: PaneState
}

export type HostReply =
  | { ok: true; pid: number }
  | { ok: true; pid: number; attached: true; exit: PaneSummary['exit'] }
  | { ok: true; panes: PaneSummary[] }
  | { ok: true; text: string }
  | { ok: true; state: PaneState }
  | { ok: true; result: Record<string, unknown> }
  | { ok: true }
  | { ok: false; error: string; missing?: boolean }

export type HostFrame =
  | { t: 'welcome'; protocol: number; appVersion: string; pid: number }
  | { t: 'refused'; error: string }
  | { t: 'reply'; id: number; reply: HostReply }
  /** `replay`: a reattached pane's screen, sent ahead of its live output. */
  | { t: 'data'; paneId: string; data: string; replay?: true }
  | { t: 'exit'; paneId: string; exitCode: number; signal: number | null }
  | { t: 'gui'; id: number; action: Record<string, unknown> }

const welcomeOrRefused = z.union([
  z.object({
    t: z.literal('welcome'),
    protocol: z.number().int(),
    appVersion: z.string(),
    pid: z.number().int()
  }),
  z.object({ t: z.literal('refused'), error: z.string() })
])

/** Host frames are trusted once the hello succeeded; only the first one is checked. */
export const parseWelcome = (frame: unknown): z.infer<typeof welcomeOrRefused> | null => {
  const r = welcomeOrRefused.safeParse(frame)
  return r.success ? r.data : null
}

export const encodeFrame = (frame: ClientFrame | HostFrame): string => JSON.stringify(frame) + '\n'

/** Largest frame accepted; a write is capped at 1 MB of text, JSON escaping can triple it. */
export const MAX_FRAME = 4 * 1024 * 1024

/**
 * A reattached screen goes out in pieces this long (#134): JSON escaping can make one
 * character six (`\u001b`), so a piece stays near 3 MB, under MAX_FRAME, however dense.
 */
export const REPLAY_CHUNK = 512 * 1024

/** Splits a replay into consecutive pieces, never cutting a surrogate pair in two. */
export function chunkReplay(text: string, max = REPLAY_CHUNK): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length;) {
    let end = Math.min(text.length, i + max)
    const last = text.charCodeAt(end - 1)
    if (end < text.length && last >= 0xd800 && last <= 0xdbff && end - 1 > i) end--
    out.push(text.slice(i, end))
    i = end
  }
  return out
}

/**
 * Splits a byte stream into JSON frames. A line that is not JSON, or one over MAX_FRAME,
 * reports an error and the stream is dropped by the caller (no resync on garbage). Only each
 * new chunk is searched and a frame is joined once, so a large frame arriving in many chunks
 * stays linear (#134).
 */
export class FrameReader {
  /** The start of a frame whose newline hasn't arrived yet. */
  private parts: string[] = []
  private size = 0

  constructor(
    private readonly onFrame: (frame: unknown) => void,
    private readonly onError: (error: string) => void
  ) {}

  push(chunk: string): void {
    let from = 0
    for (let nl = chunk.indexOf('\n'); nl !== -1; nl = chunk.indexOf('\n', from)) {
      const piece = chunk.slice(from, nl)
      const line = this.parts.length ? this.parts.join('') + piece : piece
      this.parts = []
      this.size = 0
      from = nl + 1
      if (!line) continue
      let frame: unknown
      try {
        frame = JSON.parse(line)
      } catch {
        this.onError('bad frame')
        return
      }
      this.onFrame(frame)
    }
    if (from < chunk.length) {
      this.parts.push(from ? chunk.slice(from) : chunk)
      this.size += chunk.length - from
    }
    if (this.size > MAX_FRAME) {
      this.parts = []
      this.size = 0
      this.onError('frame too large')
    }
  }
}

/** What a host runs for a pane, resolved by the window (spawn-resolve.ts). */
export interface SpawnRequest {
  paneId: string
  file: string
  args: string[] | string
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
  /** For the host's pane status only; the pty itself ignores it. */
  approval?: string
}

export type SpawnResult = { ok: true; pid: number } | { ok: false; error: string }
