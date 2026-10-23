import { describe, expect, it } from 'vitest'
import type { Account } from '@shared/types'
import type { AccountLimits } from '@shared/usage'
import {
  decideSwitch,
  isLimitError,
  nextAccount,
  peakUse
} from '../../src/renderer/lib/auto-switch'

const NOW = 1_000_000_000_000
const acct = (id: string, cli: Account['cli'] = 'claude', signedIn = true): Account =>
  ({
    id,
    name: id,
    cli,
    configDir: `~/.wraithgrid/accounts/${id}`,
    color: '',
    signedIn,
    imported: false,
    icon: '',
    folderId: null
  }) as Account
const lim = (
  five: number | null,
  week: number | null = null,
  resetsAt = NOW + 3_600_000
): AccountLimits => ({
  fiveHour: five === null ? null : { utilization: five, resetsAt },
  sevenDay: week === null ? null : { utilization: week, resetsAt },
  at: NOW
})

describe('switching account at the limit (#61)', () => {
  it('reads the fullest live window; a window past its reset counts 0', () => {
    expect(peakUse(lim(0.4, 0.96), NOW)).toEqual({ pct: 96, window: 'weekly' })
    expect(peakUse(lim(0.97, 0.5), NOW)).toEqual({ pct: 97, window: '5-hour' })
    expect(peakUse(lim(0.99, null, NOW - 1), NOW)).toEqual({ pct: 0, window: '5-hour' })
    expect(peakUse(undefined, NOW)).toBeNull()
  })

  it('knows a usage-limit error from claude and codex, not other failures', () => {
    expect(isLimitError('Claude AI usage limit reached|1792771705')).toBe(true)
    expect(isLimitError("You've hit your limit · resets 3pm")).toBe(true)
    expect(isLimitError("You've hit your usage limit. Upgrade to Pro")).toBe(true)
    expect(isLimitError('usageLimitExceeded')).toBe(true)
    expect(isLimitError('The turn failed (error_during_execution).')).toBe(false)
    expect(isLimitError(null)).toBe(false)
  })

  it('picks the next account of the same CLI after this one, wrapping, signed in and with room', () => {
    const accounts = [
      acct('a'),
      acct('cx', 'codex'),
      acct('b', 'claude', false),
      acct('c'),
      acct('d')
    ]
    const limits = { c: lim(0.96), d: lim(0.2) }
    expect(nextAccount(accounts, accounts[0]!, limits, NOW, 95)?.id).toBe('d')
    expect(nextAccount(accounts, accounts[4]!, limits, NOW, 95)?.id).toBe('a')
    expect(nextAccount(accounts, accounts[0]!, { ...limits, d: lim(0.95) }, NOW, 95)).toBeNull()
    expect(
      nextAccount([acct('g', 'gemini'), acct('h', 'gemini')], acct('g', 'gemini'), {}, NOW, 95)
    ).toBeNull()
  })

  it('decides: stay under the threshold, switch at it or on a limit error, else say none is left', () => {
    const accounts = [acct('work'), acct('home')]
    const from = accounts[0]!
    expect(decideSwitch(accounts, from, { work: lim(0.5) }, NOW, 95, null)).toEqual({
      kind: 'stay'
    })
    expect(decideSwitch(accounts, from, { work: lim(0.97) }, NOW, 95, null)).toEqual({
      kind: 'switch',
      to: accounts[1],
      reason: 'work reached 97% of its 5-hour limit',
      resend: false
    })
    expect(
      decideSwitch(accounts, from, {}, NOW, 95, 'Claude AI usage limit reached|1')
    ).toMatchObject({
      kind: 'switch',
      reason: 'work hit its usage limit',
      resend: true
    })
    expect(
      decideSwitch(accounts, from, { work: lim(0.97), home: lim(0.99) }, NOW, 95, null)
    ).toEqual({
      kind: 'none-left',
      reason: 'work reached 97% of its 5-hour limit'
    })
    // A threshold of 100 waits for the window to be full.
    expect(decideSwitch(accounts, from, { work: lim(0.97) }, NOW, 100, null)).toEqual({
      kind: 'stay'
    })
  })
})
