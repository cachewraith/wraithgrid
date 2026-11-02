import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Account } from '@shared/types'
import {
  BACKOFF_MS,
  USAGE_URL,
  UsagePoller,
  parseOAuthUsage,
  readClaudeToken,
  type UsagePollDeps
} from '../../src/main/usage-poll'

const NOW = Date.parse('2026-11-02T03:00:00Z')

// The answer's shape as Anthropic sent it on 2026-11-02 (trimmed): utilization in percent.
const ANSWER = {
  five_hour: { utilization: 73.0, resets_at: '2026-11-02T06:19:59.643548+00:00' },
  seven_day: { utilization: 9.0, resets_at: '2026-11-08T03:59:59.643565+00:00' },
  seven_day_opus: null,
  extra_usage: { is_enabled: false }
}

const creds = (token: string, expiresAt = NOW + 3_600_000): string =>
  JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: 'r', expiresAt } })

const account = (id: string, extra: Partial<Account> = {}): Account =>
  ({ id, name: id, cli: 'claude', configDir: `~/acc/${id}`, signedIn: true, ...extra }) as Account

function deps(
  files: Record<string, string>,
  answer: (token: string) => { status: number; body?: unknown },
  accounts: Account[]
) {
  const calls: { url: string; auth: string }[] = []
  const got: Record<string, unknown> = {}
  let now = NOW
  const d: UsagePollDeps = {
    accounts: () => accounts,
    configDir: (a) => path.join('/home', a.id),
    readFile: (f) =>
      f in files ? Promise.resolve(files[f]!) : Promise.reject(new Error('ENOENT')),
    fetch: (url, init) => {
      const auth = init.headers.Authorization!
      calls.push({ url, auth })
      const r = answer(auth.slice('Bearer '.length))
      return Promise.resolve({ status: r.status, json: () => Promise.resolve(r.body) })
    },
    onLimits: (id, limits) => {
      got[id] = limits
    },
    now: () => now
  }
  return { d, calls, got, tick: (ms: number) => (now += ms) }
}

const file = (id: string): string => path.join('/home', id, '.credentials.json')

describe('live usage poll', () => {
  it('turns the answer into limits (percent → 0–1, ISO → ms)', () => {
    expect(parseOAuthUsage(ANSWER, NOW)).toEqual({
      fiveHour: { utilization: 0.73, resetsAt: Date.parse('2026-11-02T06:19:59.643548Z') },
      sevenDay: { utilization: 0.09, resetsAt: Date.parse('2026-11-08T03:59:59.643565Z') },
      at: NOW
    })
    expect(parseOAuthUsage({ five_hour: null, seven_day: null }, NOW)).toBeNull()
    expect(parseOAuthUsage('nope', NOW)).toBeNull()
  })

  it('reads the token; none when missing, broken or expired', async () => {
    const read = (s: string) => () => Promise.resolve(s)
    expect(await readClaudeToken('/d', read(creds('tok')), NOW)).toBe('tok')
    expect(await readClaudeToken('/d', read(creds('tok', NOW - 1)), NOW)).toBeNull()
    expect(await readClaudeToken('/d', read('{'), NOW)).toBeNull()
    expect(await readClaudeToken('/d', () => Promise.reject(new Error('x')), NOW)).toBeNull()
  })

  it('asks for each signed-in claude account with a token, and reports its limits', async () => {
    const { d, calls, got } = deps(
      { [file('work')]: creds('tok-work'), [file('codex')]: creds('tok-codex') },
      () => ({ status: 200, body: ANSWER }),
      [
        account('work'),
        account('nocreds'),
        account('out', { signedIn: false }),
        account('codex', { cli: 'codex' })
      ]
    )
    await new UsagePoller(d).poll()
    expect(calls).toEqual([{ url: USAGE_URL, auth: 'Bearer tok-work' }])
    expect(Object.keys(got)).toEqual(['work'])
  })

  it('leaves an account alone for a while after 401 or 429; other errors retry next round', async () => {
    let status = 401
    const { d, calls, tick } = deps({ [file('work')]: creds('t') }, () => ({ status }), [
      account('work')
    ])
    const poller = new UsagePoller(d)
    await poller.poll()
    await poller.poll()
    expect(calls).toHaveLength(1)
    tick(BACKOFF_MS)
    status = 500
    await poller.poll()
    await poller.poll()
    expect(calls).toHaveLength(3)
  })

  it('survives a network failure', async () => {
    const { d, got } = deps({ [file('work')]: creds('t') }, () => ({ status: 200 }), [
      account('work')
    ])
    d.fetch = () => Promise.reject(new Error('offline'))
    await expect(new UsagePoller(d).poll()).resolves.toBeUndefined()
    expect(got).toEqual({})
  })
})
