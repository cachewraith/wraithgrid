// Sign-in from a Wraithgrid dialog: runs the CLI's own login over pipes in the account's
// config dir (claude `auth login`, codex `login --device-auth`). The CLI does the OAuth and
// keeps the tokens; main only passes on the sign-in link (and codex's one-time code), the
// code the user pastes (claude), and what the CLI's status command says at the end.
import type { AgentCli } from '@shared/agent-clis'
import type { ChatChild, ChatLaunch } from './chat/sessions'
import type { LoginEvent } from '@shared/ipc-contract'

const LOGIN_HOSTS = ['claude.com', 'claude.ai', 'anthropic.com']
const OUTPUT_MAX = 64_000

interface AuthStatus {
  loggedIn: boolean
  email: string | null
  plan: string | null
}

/** How one CLI signs in over pipes. */
export interface LoginFlow {
  login: string[]
  status: string[]
  /** Sign-in links are accepted only on these hosts (and their subdomains). */
  hosts: string[]
  /** Device sign-in: it prints a one-time code to type on the page (else the page gives one). */
  device: boolean
  deviceCode(text: string): string | null
  /** Reads the status command's output (stdout, and stderr when `statusStderr`). */
  parseStatus(text: string): AuthStatus
  statusStderr: boolean
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

/** `codex login status` (0.163.0, on stderr): "Logged in using ChatGPT" / "Not logged in". */
export function parseCodexStatus(text: string): AuthStatus {
  const m = /Logged in using (ChatGPT|an API key|.+)/.exec(stripAnsi(text))
  if (!m || /not logged in/i.test(text)) return { loggedIn: false, email: null, plan: null }
  const how = m[1]!.trim()
  return { loggedIn: true, email: null, plan: how === 'an API key' ? 'API key' : how }
}

/** The one-time code `codex login --device-auth` prints after "Enter this one-time code". */
export function codexDeviceCode(text: string): string | null {
  const m = /one-time code[^\n]*\n\s*([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/.exec(stripAnsi(text))
  return m ? m[1]! : null
}

export const LOGIN_FLOWS: Partial<Record<AgentCli, LoginFlow>> = {
  claude: {
    login: ['auth', 'login'],
    status: ['auth', 'status', '--json'],
    hosts: LOGIN_HOSTS,
    device: false,
    deviceCode: () => null,
    parseStatus: (t) => parseAuthStatus(t),
    statusStderr: false
  },
  codex: {
    login: ['login', '--device-auth'],
    status: ['login', 'status'],
    hosts: ['openai.com', 'chatgpt.com'],
    device: true,
    deviceCode: codexDeviceCode,
    parseStatus: parseCodexStatus,
    statusStderr: true
  }
}

/** The sign-in link in the output, only if it is an https page on one of `hosts`. */
export function loginUrl(text: string, hosts: string[] = LOGIN_HOSTS): string | null {
  for (const m of stripAnsi(text).matchAll(/https:\/\/[^\s"'<>]+/g)) {
    try {
      const u = new URL(m[0])
      if (hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return u.toString()
    } catch {
      // Not a URL after all.
    }
  }
  return null
}

/** `claude auth status --json`: signed in, and as whom. */
export function parseAuthStatus(text: string): AuthStatus {
  try {
    const d = JSON.parse(text) as Record<string, unknown>
    const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
    return { loggedIn: d.loggedIn === true, email: s(d.email), plan: s(d.subscriptionType) }
  } catch {
    return { loggedIn: false, email: null, plan: null }
  }
}

export interface LoginsDeps {
  spawn(launch: ChatLaunch): ChatChild
  /** Runs a command to its end; resolves its stdout (and stderr after it when `stderr`). */
  run(launch: ChatLaunch, stderr?: boolean): Promise<string>
  emit(event: LoginEvent): void
}

/** One sign-in at most per account. */
export class Logins {
  private runs = new Map<string, { child: ChatChild; cancelled: boolean }>()
  constructor(private deps: LoginsDeps) {}

  start(
    accountId: string,
    login: ChatLaunch,
    status: ChatLaunch,
    flow: LoginFlow = LOGIN_FLOWS.claude!
  ): void {
    this.cancel(accountId)
    const child = this.deps.spawn(login)
    const run = { child, cancelled: false }
    this.runs.set(accountId, run)
    let out = ''
    let sent = false
    const read = (chunk: Buffer): void => {
      if (out.length < OUTPUT_MAX) out += chunk.toString('utf8')
      const url = sent ? null : loginUrl(out, flow.hosts)
      // A device sign-in shows its code after the link: wait for both.
      const code = flow.device ? flow.deviceCode(out) : null
      if (url && (code || !flow.device)) {
        sent = true
        this.deps.emit(
          code
            ? { accountId, state: 'url', url, deviceCode: code }
            : { accountId, state: 'url', url }
        )
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    let ended = false
    const end = (error: string | null): void => {
      if (ended) return
      ended = true
      if (this.runs.get(accountId) === run) this.runs.delete(accountId)
      if (run.cancelled) return
      void this.deps
        .run(status, flow.statusStderr)
        .catch(() => '')
        .then((text) => {
          const s = flow.parseStatus(text)
          // claude's last line, without its code prompt (printed with no line break after it).
          const last = (out.trim().split('\n').at(-1) ?? '').replace(/^.*prompted >/, '').trim()
          this.deps.emit({
            accountId,
            state: 'done',
            ok: s.loggedIn,
            email: s.email,
            plan: s.plan,
            error: s.loggedIn ? null : error || last || 'Sign-in did not finish.'
          })
        })
    }
    child.once('exit', () => end(null))
    child.once('error', (err) => end(`Could not run ${login.file}: ${err.message}`))
  }

  /** The code the sign-in page showed, typed into claude's prompt. */
  code(accountId: string, code: string): boolean {
    const run = this.runs.get(accountId)
    if (!run) return false
    run.child.stdin.write(`${code}\n`)
    return true
  }

  cancel(accountId: string): void {
    const run = this.runs.get(accountId)
    if (!run) return
    run.cancelled = true
    this.runs.delete(accountId)
    run.child.kill()
  }

  stopAll(): void {
    for (const id of [...this.runs.keys()]) this.cancel(id)
  }
}
