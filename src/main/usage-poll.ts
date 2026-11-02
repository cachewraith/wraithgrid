// Live plan limits for claude accounts: every few minutes, each signed-in account's 5-hour and
// weekly use from Anthropic, the same answer claude's own /usage shows. Without this an
// account's numbers only moved after one of its chat turns. The account's OAuth token is read
// from its own config dir here in main, sent only to api.anthropic.com, and never logged or
// passed to the window. An expired token is skipped (the CLI refreshes it on its next run);
// macOS keeps it in the Keychain, so nothing is polled there.
import path from 'node:path'
import type { Account } from '@shared/types'
import type { AccountLimits, UsageWindow } from '@shared/usage'

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
export const POLL_MS = 120_000
/** After a refusal (401/403) or a rate limit (429), leave that account alone this long. */
export const BACKOFF_MS = 10 * 60_000

export interface UsagePollDeps {
  /** Every configured account, from main's config copy. */
  accounts(): readonly Account[]
  /** An account's config dir resolved to an absolute path. */
  configDir(account: Account): string
  readFile(file: string): Promise<string>
  fetch(
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal }
  ): Promise<{
    status: number
    json(): Promise<unknown>
  }>
  onLimits(accountId: string, limits: AccountLimits): void
  now?: () => number
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The account's access token, or null when it has none or it has expired. */
export async function readClaudeToken(
  configDir: string,
  readFile: (file: string) => Promise<string>,
  now: number
): Promise<string | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(path.join(configDir, '.credentials.json')))
    const oauth = isObj(raw) ? raw.claudeAiOauth : null
    if (!isObj(oauth) || typeof oauth.accessToken !== 'string' || !oauth.accessToken) return null
    if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= now) return null
    return oauth.accessToken
  } catch {
    return null
  }
}

function windowOf(v: unknown): UsageWindow | null {
  if (!isObj(v) || typeof v.utilization !== 'number' || typeof v.resets_at !== 'string') return null
  const resetsAt = Date.parse(v.resets_at)
  if (!Number.isFinite(resetsAt) || !Number.isFinite(v.utilization)) return null
  // Percent here; 0–1 everywhere else (claude's `rate_limit_event`).
  return { utilization: Math.max(0, v.utilization) / 100, resetsAt }
}

/** `/api/oauth/usage`'s answer as limits; null when it has neither window. */
export function parseOAuthUsage(body: unknown, now: number): AccountLimits | null {
  if (!isObj(body)) return null
  const fiveHour = windowOf(body.five_hour)
  const sevenDay = windowOf(body.seven_day)
  return fiveHour || sevenDay ? { fiveHour, sevenDay, at: now } : null
}

export class UsagePoller {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private readonly quietUntil = new Map<string, number>()
  private readonly now: () => number

  constructor(private readonly deps: UsagePollDeps) {
    this.now = deps.now ?? Date.now
  }

  start(intervalMs = POLL_MS): void {
    if (this.timer) return
    void this.poll()
    this.timer = setInterval(() => void this.poll(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One round over the signed-in claude accounts, one at a time. */
  async poll(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (const a of this.deps.accounts()) {
        if (a.cli !== 'claude' || !a.signedIn) continue
        if ((this.quietUntil.get(a.id) ?? 0) > this.now()) continue
        await this.pollOne(a)
      }
    } finally {
      this.running = false
    }
  }

  private async pollOne(a: Account): Promise<void> {
    const token = await readClaudeToken(this.deps.configDir(a), this.deps.readFile, this.now())
    if (!token) return
    const abort = new AbortController()
    const t = setTimeout(() => abort.abort(), 15_000)
    try {
      const res = await this.deps.fetch(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'Content-Type': 'application/json'
        },
        signal: abort.signal
      })
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        this.quietUntil.set(a.id, this.now() + BACKOFF_MS)
        return
      }
      if (res.status !== 200) return
      const limits = parseOAuthUsage(await res.json(), this.now())
      if (limits) this.deps.onLimits(a.id, limits)
    } catch {
      // Offline or timed out: the next round tries again.
    } finally {
      clearTimeout(t)
    }
  }
}
