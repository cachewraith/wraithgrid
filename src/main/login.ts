// Sign-in from a Wraithgrid dialog: runs claude's own `claude auth login` over pipes in the
// account's config dir. claude does the OAuth and keeps the tokens; main only passes on the
// sign-in link, the code the user pastes, and what `claude auth status` says at the end.
import type { ChatChild, ChatLaunch } from './chat/sessions'
import type { LoginEvent } from '@shared/ipc-contract'

const LOGIN_HOSTS = ['claude.com', 'claude.ai', 'anthropic.com']
const OUTPUT_MAX = 64_000

/** The sign-in link in claude's output, only if it is an https page of Anthropic's. */
export function loginUrl(text: string): string | null {
  for (const m of text.matchAll(/https:\/\/[^\s"'<>]+/g)) {
    try {
      const u = new URL(m[0])
      if (LOGIN_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)))
        return u.toString()
    } catch {
      // Not a URL after all.
    }
  }
  return null
}

/** `claude auth status --json`: signed in, and as whom. */
export function parseAuthStatus(text: string): {
  loggedIn: boolean
  email: string | null
  plan: string | null
} {
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
  /** Runs a command to its end; resolves its stdout. */
  run(launch: ChatLaunch): Promise<string>
  emit(event: LoginEvent): void
}

/** One `claude auth login` at most per account. */
export class Logins {
  private runs = new Map<string, { child: ChatChild; cancelled: boolean }>()
  constructor(private deps: LoginsDeps) {}

  start(accountId: string, login: ChatLaunch, status: ChatLaunch): void {
    this.cancel(accountId)
    const child = this.deps.spawn(login)
    const run = { child, cancelled: false }
    this.runs.set(accountId, run)
    let out = ''
    let sent = false
    const read = (chunk: Buffer): void => {
      if (out.length < OUTPUT_MAX) out += chunk.toString('utf8')
      const url = sent ? null : loginUrl(out)
      if (url) {
        sent = true
        this.deps.emit({ accountId, state: 'url', url })
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
        .run(status)
        .catch(() => '')
        .then((text) => {
          const s = parseAuthStatus(text)
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
    child.once('error', (err) => end(`Could not run claude: ${err.message}`))
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
