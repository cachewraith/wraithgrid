// How usage numbers read: compact, never more precise than useful.

import { AGENT_CLI_SPECS, type AgentCli } from '@shared/agent-clis'
import type { Config } from '@shared/types'

/** `$0.14`, `$12.40`, `$1.2K`; tiny amounts read `<$0.01`. */
export function fmtCost(usd: number): string {
  if (usd <= 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  if (usd < 1000) return `$${usd.toFixed(2)}`
  return `$${(usd / 1000).toFixed(usd < 10_000 ? 1 : 0)}K`
}

/** `940`, `12.9K`, `1.2M`. */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

/** Time until `at`: `2h 14m`, `42m 10s`, `3d 4h`; `now` once it has passed. */
export function fmtUntil(at: number, now: number): string {
  const s = Math.max(0, Math.round((at - now) / 1000))
  if (s === 0) return 'now'
  const d = Math.floor(s / 86_400)
  const h = Math.floor((s % 86_400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s % 60}s`
}

export type Severity = 'ok' | 'warn' | 'err'

/** How full a limit is: under 70% fine, under 90% a warning, then serious. */
export function severity(utilization: number): Severity {
  return utilization >= 0.9 ? 'err' : utilization >= 0.7 ? 'warn' : 'ok'
}

type LimitConfig = Pick<Config, 'accounts' | 'workspaces' | 'settings'>

/** Accounts whose CLI reports plan limits (claude, codex; #53). */
export const limitAccounts = <A extends { cli: AgentCli }>(accounts: A[]): A[] =>
  accounts.filter((a) => AGENT_CLI_SPECS[a.cli].reportsLimits)

/**
 * Whose limits the top-bar pill and the sidebar row show: the focused pane's account when its
 * CLI reports limits (they are per account), else the default one, else the first such.
 */
export function limitAccountId(config: LimitConfig, focusedPaneId: string | null): string | null {
  const claude = limitAccounts(config.accounts)
  const isClaude = (id: string | null | undefined): id is string =>
    !!id && claude.some((a) => a.id === id)
  const focused = focusedPaneId
    ? config.workspaces.flatMap((w) => w.panes).find((p) => p.id === focusedPaneId)
    : undefined
  if (focused && !focused.shell && isClaude(focused.accountId)) return focused.accountId
  const def = config.settings.defaultAccountId
  return isClaude(def) ? def : (claude[0]?.id ?? null)
}

/** Whether the pill shows the focused chat's account or, with none, the one new chats use. */
export function limitIsFocused(config: LimitConfig, focusedPaneId: string | null): boolean {
  const id = limitAccountId(config, focusedPaneId)
  const focused = focusedPaneId
    ? config.workspaces.flatMap((w) => w.panes).find((p) => p.id === focusedPaneId)
    : undefined
  return !!id && !!focused && !focused.shell && focused.accountId === id
}

/**
 * Open panes per account, across every project (#49): each pane runs its own account, so
 * the account menu and Usage say which ones are in use. Plain shells run no account.
 */
export function panesPerAccount(config: Pick<Config, 'workspaces'>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of config.workspaces.flatMap((w) => w.panes))
    if (!p.shell && p.accountId) out[p.accountId] = (out[p.accountId] ?? 0) + 1
  return out
}

/** `1 pane open`, `3 panes open`. */
export const panesOpen = (n: number): string => `${n} pane${n === 1 ? '' : 's'} open`
