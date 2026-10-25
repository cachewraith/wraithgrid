// Switching account at the limit (#61): after a turn, a chat whose account is at (or past) its
// 5-hour or weekly limit carries on as the next account of the same CLI that still has room.
// The conversation is copied as with "Continue as…", so the next account has all of it.
// Pure: the store decides when to ask and does the switch.
import { CONTINUE_AS_CLIS } from '@shared/agent-clis'
import type { Account } from '@shared/types'
import { liveWindow, type AccountLimits } from '@shared/usage'

/** The fullest of an account's windows right now (a window past its reset counts 0). */
export function peakUse(
  limits: AccountLimits | undefined,
  now: number
): { pct: number; window: '5-hour' | 'weekly' } | null {
  if (!limits) return null
  const five = liveWindow(limits.fiveHour, now)
  const week = liveWindow(limits.sevenDay, now)
  if (!five && !week) return null
  const f = five?.utilization ?? -1
  const w = week?.utilization ?? -1
  return f >= w
    ? { pct: Math.round(f * 100), window: '5-hour' }
    : { pct: Math.round(w * 100), window: 'weekly' }
}

/**
 * A turn that failed because the account is out of quota. claude: "Claude AI usage limit
 * reached|…", "You've hit your limit · resets …", "You've hit your session limit · resets …"; codex: "You've hit your usage limit…",
 * `usageLimitExceeded`. Rate limits of the API itself (429 "slow down") are not this.
 */
export function isLimitError(error: string | null): boolean {
  if (!error) return false
  return /usage limit|hit your (?:usage |session |weekly )?limit|limit reached|usageLimitExceeded|out of (?:credits|quota)/i.test(
    error
  )
}

/**
 * The account to carry on as: the first account after `from` in the list (wrapping) of the
 * same CLI that is signed in and below `threshold` (percent). Accounts with no known limits
 * yet count as having room.
 */
export function nextAccount(
  accounts: readonly Account[],
  from: Account,
  limits: Record<string, AccountLimits>,
  now: number,
  threshold: number
): Account | null {
  if (!CONTINUE_AS_CLIS.includes(from.cli)) return null
  const at = accounts.findIndex((a) => a.id === from.id)
  const order = [...accounts.slice(at + 1), ...accounts.slice(0, Math.max(at, 0))]
  return (
    order.find(
      (a) =>
        a.id !== from.id &&
        a.cli === from.cli &&
        a.signedIn &&
        (peakUse(limits[a.id], now)?.pct ?? 0) < threshold
    ) ?? null
  )
}

export type SwitchDecision =
  | { kind: 'stay' }
  | { kind: 'switch'; to: Account; reason: string; resend: boolean }
  | { kind: 'none-left'; reason: string }

/** What to do after a turn of `from` ended (with `error`, or null). */
export function decideSwitch(
  accounts: readonly Account[],
  from: Account,
  limits: Record<string, AccountLimits>,
  now: number,
  threshold: number,
  error: string | null
): SwitchDecision {
  if (!CONTINUE_AS_CLIS.includes(from.cli)) return { kind: 'stay' }
  const hitError = isLimitError(error)
  const peak = peakUse(limits[from.id], now)
  if (!hitError && (!peak || peak.pct < threshold)) return { kind: 'stay' }
  const reason = hitError
    ? `${from.name} hit its usage limit`
    : `${from.name} reached ${peak!.pct}% of its ${peak!.window} limit`
  const to = nextAccount(accounts, from, limits, now, threshold)
  return to ? { kind: 'switch', to, reason, resend: hitError } : { kind: 'none-left', reason }
}
