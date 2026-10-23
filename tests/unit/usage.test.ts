import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createClaudeAdapter } from '../../src/main/chat/claude'
import { UsageStore } from '../../src/main/usage-store'
import {
  EMPTY_USAGE,
  addTurn,
  hasCost,
  dayKey,
  liveWindow,
  pruneUsage,
  summarizeUsage,
  usageDataSchema,
  type TurnUsage
} from '@shared/usage'
import {
  fmtCost,
  fmtTokens,
  fmtUntil,
  limitAccountId,
  limitIsFocused,
  panesOpen,
  panesPerAccount,
  severity
} from '../../src/renderer/lib/usage-format'
import { defaultConfig } from '../../src/shared/schema'
import type { Account, Config, Pane } from '../../src/shared/types'

// Real claude 2.1.306 output (cleaned): a rate_limit_event and the turn's result.
const REAL = fs
  .readFileSync(path.join(__dirname, '../fixtures/claude-usage.ndjson'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as unknown)

const NOW = new Date('2026-10-21T15:00:00').getTime()
const DAY = 86_400_000
const turn = (costUsd: number, input = 10): TurnUsage => ({
  model: 'claude-opus-5-5',
  costUsd,
  input,
  output: 5,
  cacheRead: 100,
  cacheWrite: 0
})

describe('claude adapter: limits and usage', () => {
  it('reads both limit windows from rate_limit_event, resetsAt in ms', () => {
    const events = createClaudeAdapter().decode(REAL[0]).events
    expect(events).toEqual([
      {
        t: 'limits',
        limits: {
          fiveHour: { utilization: 0.26, resetsAt: 1792600800_000 },
          sevenDay: { utilization: 0.3, resetsAt: 1792900800_000 },
          at: expect.any(Number)
        }
      }
    ])
  })

  it('reads tokens, cost and model from the result', () => {
    const end = createClaudeAdapter()
      .decode(REAL[1])
      .events.find((e) => e.t === 'turnEnd')
    expect(end).toMatchObject({
      costUsd: 0.13964780000000002,
      usage: {
        model: 'claude-opus-5-5',
        input: 2,
        output: 14,
        cacheRead: 8919,
        cacheWrite: 17197
      }
    })
  })

  it('ignores a rate_limit_event without windows, and a result without cost or usage', () => {
    const a = createClaudeAdapter()
    expect(
      a.decode({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }).events
    ).toEqual([])
    const end = a.decode({ type: 'result', subtype: 'success' }).events[0]
    expect(end).toMatchObject({ t: 'turnEnd', usage: null })
  })
})

describe('usage data', () => {
  const owner = { accountId: 'a1', workspaceId: 'w1', paneId: 'p1', title: 'api' }

  it('a turn with no cost (codex, agy) counts its tokens, and its cost as unknown (#53)', () => {
    const tokensOnly = { ...turn(0), costUsd: null }
    let d = addTurn(EMPTY_USAGE, { ...owner, accountId: 'cx', at: NOW, usage: tokensOnly })
    d = addTurn(d, { ...owner, accountId: 'cx', at: NOW + 1, usage: tokensOnly })
    expect(d.buckets[0]).toMatchObject({ costUsd: 0, turns: 2, unpriced: 2, input: 20 })
    const sum = summarizeUsage(d, 'today', NOW)
    expect(sum.accounts.cx).toMatchObject({ turns: 2, unpriced: 2 })
    expect(hasCost(sum.accounts.cx!)).toBe(false)
    expect(hasCost(sum.chats[0]!)).toBe(false)
    // Mixed with a priced claude turn: the total has a cost, codex's part adds nothing to it.
    d = addTurn(d, { ...owner, accountId: 'cl', at: NOW, usage: turn(0.5) })
    const mixed = summarizeUsage(d, 'today', NOW)
    expect(mixed.total).toMatchObject({ costUsd: 0.5, turns: 3, unpriced: 2 })
    expect(hasCost(mixed.total)).toBe(true)
    // Files written before #53 have no `unpriced`: every turn there had a cost.
    expect(
      usageDataSchema.parse({ buckets: [{ ...d.buckets[1], unpriced: undefined }] }).buckets[0]!
        .unpriced
    ).toBe(0)
  })

  it('adds turns into one bucket per day, account, project and chat', () => {
    let d = addTurn(EMPTY_USAGE, { ...owner, at: NOW, usage: turn(0.5) })
    d = addTurn(d, { ...owner, at: NOW + 1000, usage: turn(0.25) })
    d = addTurn(d, { ...owner, paneId: 'p2', title: 'web', at: NOW, usage: turn(1) })
    d = addTurn(d, { ...owner, at: NOW - DAY, usage: turn(2) })
    expect(d.buckets).toHaveLength(3)
    expect(d.buckets[0]).toMatchObject({ day: dayKey(NOW), costUsd: 0.75, turns: 2, input: 20 })
  })

  it('summarizes a range: totals, per-account daily series, projects and top chats', () => {
    let d = EMPTY_USAGE
    d = addTurn(d, { ...owner, at: NOW, usage: turn(0.5) })
    d = addTurn(d, {
      ...owner,
      paneId: 'p2',
      title: 'web',
      workspaceId: 'w2',
      at: NOW,
      usage: turn(1)
    })
    d = addTurn(d, { ...owner, at: NOW - 3 * DAY, usage: turn(2) })
    d = addTurn(d, { ...owner, accountId: 'a2', at: NOW - 20 * DAY, usage: turn(4) })

    const today = summarizeUsage(d, 'today', NOW)
    expect(today.total.costUsd).toBeCloseTo(1.5)
    expect(today.accounts.a1!.daily).toHaveLength(7)
    // The week's trend is there even for "Today"; totals are today's only.
    expect(today.accounts.a1!.daily.reduce((s, p) => s + p.costUsd, 0)).toBeCloseTo(3.5)
    expect(today.accounts.a1!.costUsd).toBeCloseTo(1.5)

    const week = summarizeUsage(d, '7d', NOW)
    expect(week.total.costUsd).toBeCloseTo(3.5)
    expect(week.projects.map((p) => p.workspaceId)).toEqual(['w1', 'w2'])
    expect(week.chats[0]).toMatchObject({ paneId: 'p1', costUsd: 2.5 })
    expect(week.accounts.a2).toBeUndefined()

    const month = summarizeUsage(d, '30d', NOW)
    expect(month.total.costUsd).toBeCloseTo(7.5)
    expect(month.accounts.a2!.daily).toHaveLength(30)
    expect(month.total.tokens).toBe(4 * 115)
  })

  it('keeps 90 days, and a passed limit window reads as empty', () => {
    const d = addTurn(EMPTY_USAGE, { ...owner, at: NOW - 95 * DAY, usage: turn(1) })
    expect(pruneUsage(d, NOW).buckets).toEqual([])
    expect(liveWindow({ utilization: 0.8, resetsAt: NOW - 1 }, NOW)).toEqual({
      utilization: 0,
      resetsAt: NOW - 1
    })
    expect(liveWindow(null, NOW)).toBeNull()
  })

  it('a broken usage file loads what it can', () => {
    const r = usageDataSchema.safeParse({
      buckets: 'nope',
      limits: { a1: { fiveHour: 'x', sevenDay: null, at: 1 } }
    })
    expect(r.success && r.data).toEqual({
      buckets: [],
      limits: { a1: { fiveHour: null, sevenDay: null, at: 1 } }
    })
  })
})

describe('UsageStore', () => {
  it('records turns and limits for the pane’s account and saves them', async () => {
    vi.useFakeTimers()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-usage-'))
    const file = path.join(dir, 'usage.json')
    const writes: string[] = []
    const s = new UsageStore({
      file,
      now: () => NOW,
      owner: (id) => (id === 'p1' ? { accountId: 'a1', workspaceId: 'w1', title: 'api' } : null),
      write: async (_f, text) => {
        writes.push(text)
      }
    })
    await s.load()
    s.onChatEvent('p1', {
      t: 'limits',
      limits: { fiveHour: { utilization: 0.4, resetsAt: NOW + 1000 }, sevenDay: null, at: NOW }
    })
    s.onChatEvent('p1', {
      t: 'turnEnd',
      costUsd: 0.2,
      durationMs: 1,
      error: null,
      usage: turn(0.2)
    })
    s.onChatEvent('p1', { t: 'turnEnd', costUsd: null, durationMs: 1, error: null, usage: null })
    s.onChatEvent('gone', { t: 'limits', limits: { fiveHour: null, sevenDay: null, at: NOW } })
    expect(s.get().limits).toEqual({
      a1: expect.objectContaining({ fiveHour: { utilization: 0.4, resetsAt: NOW + 1000 } })
    })
    expect(s.get().buckets).toHaveLength(1)
    expect(writes).toHaveLength(0)
    await s.flush()
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]!).buckets[0]).toMatchObject({ accountId: 'a1', costUsd: 0.2 })
    vi.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('usage formatting', () => {
  it('reads compactly', () => {
    expect(fmtCost(0)).toBe('$0')
    expect(fmtCost(0.004)).toBe('<$0.01')
    expect(fmtCost(3.184)).toBe('$3.18')
    expect(fmtCost(1234)).toBe('$1.2K')
    expect(fmtTokens(940)).toBe('940')
    expect(fmtTokens(12_900)).toBe('13K')
    expect(fmtTokens(1_234_567)).toBe('1.2M')
    expect(fmtUntil(NOW + (2 * 3600 + 14 * 60) * 1000, NOW)).toBe('2h 14m')
    expect(fmtUntil(NOW + (42 * 60 + 10) * 1000, NOW)).toBe('42m 10s')
    expect(fmtUntil(NOW + (3 * 86400 + 4 * 3600) * 1000, NOW)).toBe('3d 4h')
    expect(fmtUntil(NOW - 5, NOW)).toBe('now')
    expect([0.3, 0.75, 0.95].map(severity)).toEqual(['ok', 'warn', 'err'])
  })
})

describe('whose limits the pill shows', () => {
  const acct = (id: string, cli: Account['cli'] = 'claude'): Account =>
    ({ id, name: id, cli, configDir: `~/.wraithgrid/accounts/${id}` }) as Account
  const pane = (id: string, accountId: string | null, shell = false): Pane =>
    ({ id, accountId, shell }) as Pane
  const config = (defaultAccountId: string | null): Config => {
    const c = defaultConfig()
    c.accounts = [acct('gem', 'gemini'), acct('work'), acct('home')]
    c.workspaces[0]!.panes = [
      pane('p-home', 'home'),
      pane('p-gem', 'gem'),
      pane('p-sh', null, true)
    ]
    c.settings = { ...c.settings, defaultAccountId }
    return c
  }

  it("follows the focused pane's claude account", () => {
    expect(limitAccountId(config('work'), 'p-home')).toBe('home')
  })
  it('falls back to the default account for other panes or no focus', () => {
    expect(limitAccountId(config('work'), null)).toBe('work')
    expect(limitAccountId(config('work'), 'p-gem')).toBe('work')
    expect(limitAccountId(config('work'), 'p-sh')).toBe('work')
    expect(limitAccountId(config('work'), 'gone')).toBe('work')
  })
  it('never picks a non-claude default; then the first claude account', () => {
    expect(limitAccountId(config('gem'), null)).toBe('work')
    expect(limitAccountId(config(null), null)).toBe('work')
  })
  it('is null without claude accounts', () => {
    const c = config(null)
    c.accounts = [acct('gem', 'gemini')]
    expect(limitAccountId(c, 'p-gem')).toBeNull()
  })
  it("says whether it is the focused chat's account or the new-chat one (#49)", () => {
    expect(limitIsFocused(config('work'), 'p-home')).toBe(true)
    expect(limitIsFocused(config('work'), 'p-gem')).toBe(false)
    expect(limitIsFocused(config('work'), null)).toBe(false)
  })
})

describe('accounts in use (#49)', () => {
  it('counts open panes per account across projects; shells run none', () => {
    const c = defaultConfig()
    const p = (id: string, accountId: string | null, shell = false): Pane =>
      ({ id, accountId, shell }) as Pane
    c.workspaces = [
      { ...c.workspaces[0]!, panes: [p('a', 'work'), p('b', 'home'), p('s', null, true)] },
      { ...c.workspaces[0]!, id: 'w2', panes: [p('c', 'work')] }
    ]
    expect(panesPerAccount(c)).toEqual({ work: 2, home: 1 })
    expect(panesOpen(1)).toBe('1 pane open')
    expect(panesOpen(2)).toBe('2 panes open')
  })
})
