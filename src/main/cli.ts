// `wraithgrid <command>` (H6): a client of the background host, so a script, or an agent in
// a pane, can list panes, read their screens, type into them, wait for them and open new
// ones. Runs in the app's own binary before any window exists, and exits. Pane titles and
// accounts come from config.json (read only); live state comes from the host.
import path from 'node:path'
import type { Duplex } from 'node:stream'
import { AGENT_CLI_SPECS } from '@shared/agent-clis'
import type { Config } from '@shared/types'
import { PANE_STATES, type PaneState, type PaneSummary } from '../host/protocol'
import { HostConnection } from './pane-host'

export const CLI_COMMANDS = [
  'list',
  'read',
  'send',
  'wait',
  'new',
  'split',
  'attach',
  'stop',
  'help'
] as const

/** True when the app was started as `wraithgrid <command>` rather than to open its window. */
export const isCliCommand = (arg: string | undefined): boolean =>
  !!arg &&
  ((CLI_COMMANDS as readonly string[]).includes(arg) || arg === '--help' || arg === HOST_STDIO)

/** Not in the help: what the GUI runs over ssh to reach a remote machine's host (H5). */
export const HOST_STDIO = 'host-stdio'

export interface CliDeps {
  connect: () => Promise<Duplex>
  readToken: () => Promise<string>
  readConfig: () => Promise<Config | null>
  appVersion: string
  cwd: string
  out: (text: string) => void
  err: (text: string) => void
  sleep?: (ms: number) => Promise<void>
  /** The terminal `attach` takes over; absent when stdin/stdout is not a terminal. */
  tty?: Tty
}

/** The local terminal, for `wraithgrid attach` (H7). */
export interface Tty {
  size(): { cols: number; rows: number }
  write(data: string): void
  /** Raw mode on: every key goes to the pane. */
  raw(on: boolean): void
  onInput(cb: (data: string) => void): () => void
  onResize(cb: () => void): () => void
}

/** Ctrl+]: leaves `attach`, the pane keeps running (as telnet does). */
export const DETACH_KEY = '\x1d'

/** Undoes what a pane's program may have switched on in the terminal it was drawn in. */
const TTY_RESET =
  '\x1b[?1049l\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?25h\x1b[0m'

export const CLI_HELP = `Usage: wraithgrid <command> [options]

Talks to the agents Wraithgrid runs. Turn it on first: Settings → Command line.
A pane is named by its id or its title; inside a pane, $WRAITHGRID_PANE is its own id.

  list [--json]                     panes with their state (running, idle, blocked, exited)
  read <pane> [--lines N]           the pane's screen as text (N: last N lines, scrollback too)
  send <pane> <text…> [--no-enter]  types the text into the pane, then Enter
  wait <pane> [--until STATE] [--quiet MS] [--timeout S]
                                    waits until the pane is idle (default; quiet for MS,
                                    1500), running, blocked (asking for approval) or exited
  new [--account A] [--cwd DIR] [--workspace W] [--shell] [-- ARGS…]
                                    opens a pane in the window and prints its id
  split <pane> [--account A] [--cwd DIR] [--shell] [-- ARGS…]
                                    opens a pane beside another, same account and folder
  attach <pane>                     shows the pane in this terminal and types into it;
                                    Ctrl+] leaves, the pane keeps running (ssh -t works)
  stop                              stops every agent and the background host

Exit status: 0 done, 1 failed or timed out, 2 wrong usage.`

class UsageError extends Error {}

interface Parsed {
  positional: string[]
  flags: Map<string, string | true>
  /** Everything after `--`: the new pane's launch args. */
  rest: string[]
}

const VALUE_FLAGS = new Set([
  '--lines',
  '--until',
  '--quiet',
  '--timeout',
  '--account',
  '--cwd',
  '--workspace'
])

function parse(args: string[]): Parsed {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  let rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--') {
      rest = args.slice(i + 1)
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const name = eq > 0 ? a.slice(0, eq) : a
      if (VALUE_FLAGS.has(name)) {
        const value = eq > 0 ? a.slice(eq + 1) : args[++i]
        if (value === undefined) throw new UsageError(`${name} needs a value`)
        flags.set(name, value)
      } else flags.set(name, true)
    } else positional.push(a)
  }
  return { positional, flags, rest }
}

const num = (p: Parsed, flag: string, fallback: number): number => {
  const v = p.flags.get(flag)
  if (v === undefined) return fallback
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`${flag} must be a number`)
  return n
}

const str = (p: Parsed, flag: string): string | undefined => {
  const v = p.flags.get(flag)
  return typeof v === 'string' ? v : undefined
}

interface PaneRow {
  id: string
  title: string
  workspace: string
  account: string
  cli: string
  state: PaneState | 'stopped'
  pid: number | null
}

function rows(config: Config | null, live: PaneSummary[]): PaneRow[] {
  const byId = new Map(live.map((p) => [p.paneId, p]))
  const out: PaneRow[] = []
  for (const ws of config?.workspaces ?? []) {
    for (const pane of ws.panes) {
      const account = config!.accounts.find((a) => a.id === pane.accountId)
      const l = byId.get(pane.id)
      byId.delete(pane.id)
      out.push({
        id: pane.id,
        title: pane.title,
        workspace: ws.name,
        account: pane.shell ? '' : (account?.name ?? ''),
        cli: pane.shell ? 'shell' : (account?.cli ?? 'claude'),
        state: l?.state ?? 'stopped',
        pid: l?.pid ?? null
      })
    }
  }
  // Running in the host but not in the config (e.g. a pane closed from another window).
  for (const l of byId.values()) {
    out.push({
      id: l.paneId,
      title: '',
      workspace: '',
      account: '',
      cli: '',
      state: l.state,
      pid: l.pid
    })
  }
  return out
}

function table(list: PaneRow[]): string {
  const head = ['ID', 'TITLE', 'WORKSPACE', 'ACCOUNT', 'CLI', 'STATE', 'PID']
  const cells = list.map((r) => [
    r.id,
    r.title,
    r.workspace,
    r.account,
    r.cli,
    r.state,
    r.pid ? String(r.pid) : ''
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i]!.length)))
  return [head, ...cells]
    .map((c) =>
      c
        .map((v, i) => v.padEnd(widths[i]!))
        .join('  ')
        .trimEnd()
    )
    .join('\n')
}

/** A pane by id, else by a title only one pane has (case-insensitive). */
function resolvePane(ref: string, list: PaneRow[]): PaneRow {
  const exact = list.find((r) => r.id === ref)
  if (exact) return exact
  const titled = list.filter((r) => r.title.toLowerCase() === ref.toLowerCase())
  if (titled.length === 1) return titled[0]!
  if (titled.length > 1)
    throw new Error(`${titled.length} panes are titled "${ref}"; use an id (wraithgrid list).`)
  throw new Error(`No pane "${ref}" (wraithgrid list shows them).`)
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...args] = argv
  if (!command || command === 'help' || command === '--help') {
    deps.out(CLI_HELP)
    return 0
  }
  let conn: HostConnection | null = null
  try {
    const p = parse(args)
    let stream: Duplex
    try {
      stream = await deps.connect()
    } catch {
      throw new Error(
        'Wraithgrid is not running any agents (no background host). Open Wraithgrid first.'
      )
    }
    const opened = await HostConnection.open(stream, await deps.readToken(), deps.appVersion, 'cli')
    conn = opened.conn
    const c = conn
    const config = await deps.readConfig()
    const listPanes = async (): Promise<PaneRow[]> => {
      const r = await c.request({ t: 'list' })
      if (!r.ok) throw new Error(r.error)
      return rows(config, 'panes' in r ? r.panes : [])
    }
    const need = (i: number, what: string): string => {
      const v = p.positional[i]
      if (!v) throw new UsageError(`${command} needs ${what}`)
      return v
    }

    switch (command) {
      case 'list': {
        const list = await listPanes()
        deps.out(p.flags.has('--json') ? JSON.stringify(list, null, 2) : table(list))
        return 0
      }
      case 'read': {
        const pane = resolvePane(need(0, 'a pane'), await listPanes())
        const lines = p.flags.has('--lines') ? num(p, '--lines', 0) : undefined
        const r = await c.request({ t: 'read', paneId: pane.id, lines: lines || undefined })
        if (!r.ok) throw new Error(r.error)
        deps.out('text' in r ? r.text : '')
        return 0
      }
      case 'send': {
        const pane = resolvePane(need(0, 'a pane'), await listPanes())
        const text = p.positional.slice(1).join(' ')
        if (!text && p.flags.has('--no-enter')) throw new UsageError('send needs text')
        if (pane.state === 'stopped' || pane.state === 'exited')
          throw new Error(`Pane ${pane.id} is not running.`)
        // A line break inside the text is the CLI's "new line" key, not Enter.
        const newLine =
          pane.cli in AGENT_CLI_SPECS
            ? AGENT_CLI_SPECS[pane.cli as keyof typeof AGENT_CLI_SPECS].newLine
            : null
        const typed = newLine ? text.replace(/\r?\n/g, newLine) : text
        if (typed) c.send({ t: 'write', paneId: pane.id, data: typed })
        if (!p.flags.has('--no-enter')) {
          // Text and Enter in one chunk would read as a paste to some CLIs, and not submit.
          await (deps.sleep ?? defaultSleep)(120)
          c.send({ t: 'write', paneId: pane.id, data: '\r' })
        }
        // Make sure the writes left before the connection closes.
        await c.request({ t: 'list' })
        return 0
      }
      case 'wait': {
        const pane = resolvePane(need(0, 'a pane'), await listPanes())
        const until = (str(p, '--until') ?? 'idle') as PaneState
        if (!(PANE_STATES as readonly string[]).includes(until))
          throw new UsageError(`--until is one of ${PANE_STATES.join(', ')}`)
        const r = await c.request({
          t: 'wait',
          paneId: pane.id,
          until,
          quietMs: Math.round(num(p, '--quiet', 1500)),
          timeoutMs: Math.max(1, Math.round(num(p, '--timeout', 600) * 1000))
        })
        if (!r.ok) throw new Error(r.error)
        deps.out('state' in r ? r.state : until)
        return 0
      }
      case 'new':
      case 'split': {
        const base =
          command === 'split'
            ? { kind: 'split', paneId: resolvePane(need(0, 'a pane'), await listPanes()).id }
            : { kind: 'new' }
        const cwd = str(p, '--cwd')
        const action: Record<string, unknown> = {
          ...base,
          account: str(p, '--account'),
          cwd: cwd ? path.resolve(deps.cwd, cwd) : command === 'new' ? deps.cwd : undefined,
          workspace: command === 'new' ? str(p, '--workspace') : undefined,
          shell: p.flags.has('--shell') ? true : undefined,
          args: p.rest.length ? p.rest : undefined
        }
        const r = await c.request({ t: 'gui', action })
        if (!r.ok) throw new Error(r.error)
        const paneId = 'result' in r ? String(r.result.paneId ?? '') : ''
        // The window starts the pane a moment later; return once the host runs it.
        const sleep = deps.sleep ?? defaultSleep
        for (let i = 0; i < 100; i++) {
          const l = await c.request({ t: 'list' })
          if (l.ok && 'panes' in l && l.panes.some((x) => x.paneId === paneId)) break
          await sleep(100)
        }
        deps.out(paneId)
        return 0
      }
      case 'attach': {
        const pane = resolvePane(need(0, 'a pane'), await listPanes())
        const tty = deps.tty
        if (!tty) throw new Error('attach needs a terminal (over ssh, use ssh -t).')
        if (pane.state === 'stopped') throw new Error(`Pane ${pane.id} is not running.`)
        return await attach(c, pane.id, tty)
      }
      case 'stop': {
        const live = (await listPanes()).filter(
          (r) => r.state !== 'stopped' && r.state !== 'exited'
        ).length
        const r = await c.request({ t: 'shutdown', exit: true })
        if (!r.ok) throw new Error(r.error)
        deps.out(`Stopped ${live} agent${live === 1 ? '' : 's'}.`)
        return 0
      }
      default:
        throw new UsageError(`Unknown command "${command}"`)
    }
  } catch (err) {
    if (err instanceof UsageError) {
      deps.err(`wraithgrid: ${err.message}\n\n${CLI_HELP}`)
      return 2
    }
    deps.err(`wraithgrid: ${(err as Error).message}`)
    return 1
  } finally {
    conn?.close()
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Mirrors one pane in the terminal until Ctrl+], the pane's exit or the host's. */
function attach(c: HostConnection, paneId: string, tty: Tty): Promise<number> {
  return new Promise((resolve) => {
    const cleanups: (() => void)[] = []
    let finished = false
    const finish = (code: number, note: string): void => {
      if (finished) return
      finished = true
      cleanups.forEach((f) => f())
      tty.raw(false)
      tty.write(`${TTY_RESET}\r\n[${note}]\r\n`)
      resolve(code)
    }
    // The screen comes first as a replay frame, then live output, both in stream order.
    c.onData = (id, data, replay) => {
      if (id !== paneId) return
      tty.write(replay ? `\x1b[H\x1b[2J${data}` : data)
    }
    c.onExit = (id, exitCode) => {
      if (id === paneId) finish(0, `pane exited with code ${exitCode}`)
    }
    c.onClose = () => finish(1, 'the background host stopped')
    tty.raw(true)
    cleanups.push(
      tty.onInput((data) => {
        const cut = data.indexOf(DETACH_KEY)
        if (cut >= 0) {
          if (cut > 0) c.send({ t: 'write', paneId, data: data.slice(0, cut) })
          finish(0, `detached from ${paneId}; it keeps running`)
        } else c.send({ t: 'write', paneId, data })
      }),
      tty.onResize(() => c.send({ t: 'resize', paneId, ...tty.size() }))
    )
    void c.request({ t: 'attach', paneId, ...tty.size() }).then((r) => {
      if (!r.ok) finish(1, r.error)
      else if ('attached' in r && r.exit) finish(0, `pane exited with code ${r.exit.exitCode}`)
    })
  })
}
