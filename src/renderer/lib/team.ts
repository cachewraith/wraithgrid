// A project's team (#79): its saved agents, what Start team does with each, and what to warn
// about first. Pure: the store runs the plan.
import { slugify } from '@shared/paths'
import type { Account, Pane, TeamAgent } from '@shared/types'
import type { AccountLimits } from '@shared/usage'
import { peakUse } from './auto-switch'

/** The agent's own branch: `team/<role>` (its worktree folder is `team-<role>`). */
export function teamBranch(role: string): string {
  return `team/${slugify(role) || 'agent'}`
}

export type TeamStep =
  /** Already open: focus it rather than start it twice. */
  | { kind: 'focus'; agent: TeamAgent; paneId: string }
  | { kind: 'start'; agent: TeamAgent; account: Account }
  /** Its account was removed: skipped. */
  | { kind: 'skip'; agent: TeamAgent }

export function planTeam(
  team: readonly TeamAgent[],
  accounts: readonly Account[],
  panes: readonly Pane[]
): TeamStep[] {
  return team.map((agent): TeamStep => {
    const open = panes.find((p) => p.teamAgentId === agent.id)
    if (open) return { kind: 'focus', agent, paneId: open.id }
    const account = accounts.find((a) => a.id === agent.accountId)
    return account ? { kind: 'start', agent, account } : { kind: 'skip', agent }
  })
}

/** Why some agents may not run: a missing account, or one at its 5-hour or weekly limit. */
export function teamWarnings(
  steps: readonly TeamStep[],
  limits: Record<string, AccountLimits>,
  now: number
): { agent: TeamAgent; text: string }[] {
  const out: { agent: TeamAgent; text: string }[] = []
  for (const s of steps) {
    if (s.kind === 'skip') out.push({ agent: s.agent, text: 'account missing · skipped' })
    if (s.kind !== 'start') continue
    const peak = peakUse(limits[s.account.id], now)
    if (peak && peak.pct >= 100)
      out.push({ agent: s.agent, text: `${peak.window} limit ${peak.pct}%` })
  }
  return out
}

/** The team's open panes, in the team's order. */
export function teamPaneIds(team: readonly TeamAgent[], panes: readonly Pane[]): string[] {
  return team.flatMap((a) => panes.filter((p) => p.teamAgentId === a.id).map((p) => p.id))
}

/** Accounts that two or more agents use: they share its limit (#100). */
export function sharedAccounts(
  team: readonly TeamAgent[]
): { accountId: string; roles: string[] }[] {
  const by = new Map<string, string[]>()
  for (const a of team)
    if (a.accountId) by.set(a.accountId, [...(by.get(a.accountId) ?? []), a.role])
  return [...by]
    .filter(([, roles]) => roles.length > 1)
    .map(([accountId, roles]) => ({ accountId, roles }))
}
