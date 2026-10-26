// Usage: what chat turns used (from the CLI's own reports), kept per day, account, project
// and chat in userData/usage.json; and each account's plan limits as the CLI last reported
// them (claude's `rate_limit_event`, codex's `account/rateLimits`). claude reports a cost;
// codex and agy only tokens (#53). Terminal panes are not measured: their output is a
// screen, not data. Pure functions, so main records and the renderer summarizes the same way.
import { z } from 'zod'

/** One limit window: how much of it is used (0–1) and when it starts over (ms). */
export interface UsageWindow {
  utilization: number
  resetsAt: number
}

export interface AccountLimits {
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  /** When the CLI said so (ms). */
  at: number
}

/** What one turn used, from the CLI's `result`. */
export interface TurnUsage {
  model: string | null
  /** null: the CLI reports no cost (codex, agy); never guessed. */
  costUsd: number | null
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface UsageBucket {
  /** Local day, `YYYY-MM-DD`. */
  day: string
  accountId: string | null
  workspaceId: string | null
  paneId: string
  /** The chat's title when it last ran. */
  title: string
  costUsd: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  turns: number
  /** Turns whose CLI reported no cost: their cost is unknown, not $0. */
  unpriced: number
}

export interface UsageData {
  buckets: UsageBucket[]
  limits: Record<string, AccountLimits>
}

export const USAGE_DAYS = 90
export const EMPTY_USAGE: UsageData = { buckets: [], limits: {} }

const num = z.number().finite().min(0).catch(0)
const windowSchema = z
  .object({ utilization: z.number().finite(), resetsAt: z.number().finite() })
  .nullable()
  .catch(null)
export const usageDataSchema = z.object({
  buckets: z
    .array(
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        accountId: z.string().max(64).nullable(),
        workspaceId: z.string().max(64).nullable(),
        paneId: z.string().min(1).max(64),
        title: z.string().max(200).catch(''),
        costUsd: num,
        input: num,
        output: num,
        cacheRead: num,
        cacheWrite: num,
        turns: num,
        unpriced: num
      })
    )
    .max(50_000)
    .catch([]),
  limits: z
    .record(
      z.string().max(64),
      z.object({ fiveHour: windowSchema, sevenDay: windowSchema, at: z.number().finite() })
    )
    .catch({})
})

/** Local calendar day of `ms`, `YYYY-MM-DD`. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * The local day `n` calendar days before `now`'s. By the calendar, not n × 24 h: across a
 * clock change that skips or repeats a day (#140). From noon, which every day has.
 */
export function dayKeyBefore(now: number, n: number): string {
  const d = new Date(now)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return dayKey(d.getTime())
}

/** Adds one turn to its day/account/project/chat bucket. */
export function addTurn(
  data: UsageData,
  t: {
    at: number
    accountId: string | null
    workspaceId: string | null
    paneId: string
    title: string
    usage: TurnUsage
  }
): UsageData {
  const day = dayKey(t.at)
  const u = t.usage
  let found = false
  const buckets = data.buckets.map((b) => {
    if (
      b.day !== day ||
      b.paneId !== t.paneId ||
      b.accountId !== t.accountId ||
      b.workspaceId !== t.workspaceId
    )
      return b
    found = true
    return {
      ...b,
      title: t.title || b.title,
      costUsd: b.costUsd + (u.costUsd ?? 0),
      input: b.input + u.input,
      output: b.output + u.output,
      cacheRead: b.cacheRead + u.cacheRead,
      cacheWrite: b.cacheWrite + u.cacheWrite,
      turns: b.turns + 1,
      unpriced: b.unpriced + (u.costUsd === null ? 1 : 0)
    }
  })
  if (!found)
    buckets.push({
      day,
      accountId: t.accountId,
      workspaceId: t.workspaceId,
      paneId: t.paneId,
      title: t.title,
      costUsd: u.costUsd ?? 0,
      input: u.input,
      output: u.output,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
      turns: 1,
      unpriced: u.costUsd === null ? 1 : 0
    })
  return { ...data, buckets }
}

/** Drops days older than USAGE_DAYS. */
export function pruneUsage(data: UsageData, now: number): UsageData {
  const oldest = dayKeyBefore(now, USAGE_DAYS - 1)
  return { ...data, buckets: data.buckets.filter((b) => b.day >= oldest) }
}

export type UsageRange = 'today' | '7d' | '30d'
export const RANGE_DAYS: Record<UsageRange, number> = { today: 1, '7d': 7, '30d': 30 }

export interface UsageTotals {
  costUsd: number
  /** Everything sent and received, cache included. */
  tokens: number
  turns: number
  /** Of `turns`, those with no cost reported (codex, agy). */
  unpriced: number
}

/** Some of it has a known cost: else the cost reads "–", not $0. */
export const hasCost = (t: { turns: number; unpriced: number }): boolean => t.unpriced < t.turns

export interface UsageSummary {
  total: UsageTotals
  /** Per account: totals in the range, and cost per day (oldest first). */
  accounts: Record<string, UsageTotals & { daily: { day: string; costUsd: number }[] }>
  projects: (UsageTotals & { workspaceId: string | null })[]
  chats: {
    paneId: string
    title: string
    workspaceId: string | null
    costUsd: number
    turns: number
    unpriced: number
  }[]
}

const tokensOf = (b: UsageBucket): number => b.input + b.output + b.cacheRead + b.cacheWrite

/**
 * Totals for the range ending today. The per-day series always covers at least 7 days, so
 * "Today" still shows a week of trend.
 */
export function summarizeUsage(data: UsageData, range: UsageRange, now: number): UsageSummary {
  const days = RANGE_DAYS[range]
  const seriesDays = Math.max(days, 7)
  const series = Array.from({ length: seriesDays }, (_, i) => dayKeyBefore(now, seriesDays - 1 - i))
  const from = series[seriesDays - days]!
  const dayIndex = new Map(series.map((day, i) => [day, i]))
  const total: UsageTotals = { costUsd: 0, tokens: 0, turns: 0, unpriced: 0 }
  const accounts: UsageSummary['accounts'] = {}
  const projects = new Map<string | null, UsageTotals>()
  const chats = new Map<string, UsageSummary['chats'][number]>()
  for (const b of data.buckets) {
    if (b.day < series[0]!) continue
    const key = b.accountId ?? ''
    const a = (accounts[key] ??= {
      costUsd: 0,
      tokens: 0,
      turns: 0,
      unpriced: 0,
      daily: series.map((day) => ({ day, costUsd: 0 }))
    })
    const i = dayIndex.get(b.day)
    if (i !== undefined) a.daily[i]!.costUsd += b.costUsd
    if (b.day < from) continue
    a.costUsd += b.costUsd
    a.tokens += tokensOf(b)
    a.turns += b.turns
    a.unpriced += b.unpriced
    total.costUsd += b.costUsd
    total.tokens += tokensOf(b)
    total.turns += b.turns
    total.unpriced += b.unpriced
    const p = projects.get(b.workspaceId) ?? { costUsd: 0, turns: 0, tokens: 0, unpriced: 0 }
    projects.set(b.workspaceId, {
      costUsd: p.costUsd + b.costUsd,
      turns: p.turns + b.turns,
      tokens: p.tokens + tokensOf(b),
      unpriced: p.unpriced + b.unpriced
    })
    const c = chats.get(b.paneId) ?? {
      paneId: b.paneId,
      title: b.title,
      workspaceId: b.workspaceId,
      costUsd: 0,
      turns: 0,
      unpriced: 0
    }
    chats.set(b.paneId, {
      ...c,
      title: b.title || c.title,
      costUsd: c.costUsd + b.costUsd,
      turns: c.turns + b.turns,
      unpriced: c.unpriced + b.unpriced
    })
  }
  return {
    total,
    accounts,
    projects: [...projects]
      .map(([workspaceId, v]) => ({ workspaceId, ...v }))
      .sort((x, y) => y.costUsd - x.costUsd),
    chats: [...chats.values()].sort((x, y) => y.costUsd - x.costUsd).slice(0, 5)
  }
}

/** A window that has passed its reset time reads as empty: the CLI has not said more yet. */
export function liveWindow(w: UsageWindow | null, now: number): UsageWindow | null {
  if (!w) return null
  return w.resetsAt <= now ? { utilization: 0, resetsAt: w.resetsAt } : w
}
