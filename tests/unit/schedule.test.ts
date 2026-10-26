import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scheduledJobSchema } from '@shared/schema'
import {
  describeWhen,
  dueAction,
  MISSED_AFTER_MS,
  nextRun,
  parseLocal,
  soonestRun,
  SCHEDULE_RUNS_MAX,
  settleOf,
  toLocal,
  withRun
} from '@shared/schedule'

// Wall-clock maths against a zone with daylight saving (Europe/Berlin: 26 Oct 2025 03:00 → 02:00).
let tz: string | undefined
beforeAll(() => {
  tz = process.env.TZ
  process.env.TZ = 'Europe/Berlin'
})
afterAll(() => {
  process.env.TZ = tz
})

const at = (s: string): number => parseLocal(s)

describe('scheduled chats (#77)', () => {
  it('reads and writes local date-times', () => {
    expect(toLocal(at('2026-10-27T09:05'))).toBe('2026-10-27T09:05')
    expect(parseLocal('27/10/2026')).toBeNaN()
  })

  it('weekdays at 09:00, across a weekend and the daylight-saving change', () => {
    const w = { kind: 'weekly' as const, days: [1, 2, 3, 4, 5], time: '09:00' }
    // Friday 24 Oct 2025 10:00 → Monday 27 Oct 09:00 (after the clocks went back on Sunday).
    expect(toLocal(nextRun(w, at('2025-10-24T10:00'))!)).toBe('2025-10-27T09:00')
    // Before 09:00 on a weekday: the same day.
    expect(toLocal(nextRun(w, at('2025-10-27T08:59'))!)).toBe('2025-10-27T09:00')
    // Daily through the change keeps 09:00 local, even though that day has 25 hours.
    const daily = { kind: 'weekly' as const, days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' }
    const sat = at('2025-10-25T09:00')
    const sun = nextRun(daily, sat)!
    expect(toLocal(sun)).toBe('2025-10-26T09:00')
    expect(sun - sat).toBe(25 * 3600_000)
  })

  it('every N hours from a time each day, and once only in the future', () => {
    const h = { kind: 'hours' as const, every: 6, from: '09:00' }
    expect(toLocal(nextRun(h, at('2026-03-10T10:00'))!)).toBe('2026-03-10T15:00')
    expect(toLocal(nextRun(h, at('2026-03-10T21:00'))!)).toBe('2026-03-11T09:00')
    expect(toLocal(nextRun(h, at('2026-03-10T05:00'))!)).toBe('2026-03-10T09:00')
    const once = { kind: 'once' as const, at: '2026-03-10T12:00' }
    expect(nextRun(once, at('2026-03-10T11:00'))).toBe(at('2026-03-10T12:00'))
    expect(nextRun(once, at('2026-03-10T12:00'))).toBeNull()
  })

  it('a reset job waits for the reset time it is given', () => {
    const r = { kind: 'reset' as const, window: 'fiveHour' as const }
    expect(nextRun(r, 1000)).toBeNull()
    expect(nextRun(r, 1000, 5000)).toBe(5000)
    expect(nextRun(r, 6000, 5000)).toBeNull()
  })

  it('runs a due job, records one found over an hour late as missed', () => {
    const job = { enabled: true, nextAt: 10_000 }
    expect(dueAction(job, 9_999)).toBeNull()
    expect(dueAction(job, 10_000 + MISSED_AFTER_MS)).toBe('run')
    expect(dueAction(job, 10_001 + MISSED_AFTER_MS)).toBe('missed')
    expect(dueAction({ ...job, enabled: false }, 20_000)).toBeNull()
    expect(soonestRun([job, { enabled: true, nextAt: 5 }, { enabled: false, nextAt: 1 }])).toBe(5)
  })

  it('keeps the newest runs, and drops a bad job rather than the list', () => {
    let job = { runs: [] as { at: number; result: 'done'; paneId: null; note: string }[] }
    for (let i = 0; i < 25; i++)
      job = withRun(job, { at: i, result: 'done', paneId: null, note: '' })
    expect(job.runs).toHaveLength(SCHEDULE_RUNS_MAX)
    expect(job.runs[0]!.at).toBe(24)
    const ok = {
      id: 'j1',
      wsId: 'w',
      accountId: 'a',
      prompt: 'Review PRs',
      when: { kind: 'weekly', days: [1], time: '09:00' }
    }
    expect(scheduledJobSchema.parse(ok)).toMatchObject({ target: { kind: 'new' }, atLimit: 'wait' })
    expect(
      scheduledJobSchema.safeParse({ ...ok, when: { kind: 'weekly', days: [], time: '9' } }).success
    ).toBe(false)
  })

  it('says when in words', () => {
    expect(describeWhen({ kind: 'weekly', days: [5, 1, 2, 3, 4], time: '09:00' })).toBe(
      'weekdays 09:00'
    )
    expect(describeWhen({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '18:30' })).toBe(
      'daily 18:30'
    )
    expect(describeWhen({ kind: 'weekly', days: [1, 4], time: '09:00' })).toBe('Mon, Thu 09:00')
    expect(describeWhen({ kind: 'hours', every: 6, from: '09:00' })).toBe('every 6 hours')
    expect(describeWhen({ kind: 'reset', window: 'fiveHour' }, 'work')).toBe(
      'work 5-hour limit resets'
    )
  })

  it('only a run this launch started says "done"; a stale one settles quietly (#117)', () => {
    const run = { at: 1_000, result: 'running' as const, paneId: 'p1', note: '' }
    const view = { live: true, pane: 'open' as const, exited: false, quiet: true, now: 60_000 }
    // Its own turn ended: done, with the notification.
    expect(settleOf(run, view)).toEqual({ result: 'done', note: '', notify: true })
    // Still going, or quiet within 10 s of the send: not yet.
    expect(settleOf(run, { ...view, quiet: false })).toBeNull()
    expect(settleOf(run, { ...view, now: 5_000 })).toBeNull()
    // Left running by an earlier launch: an unrelated later turn in that chat never notifies.
    expect(settleOf(run, { ...view, live: false })).toEqual({
      result: 'failed',
      note: 'interrupted: Wraithgrid closed during the run',
      notify: false
    })
    expect(settleOf(run, { ...view, live: false, quiet: false })?.notify).toBe(false)
    // Closed to History (it ran), or gone: settled, never notified.
    expect(settleOf(run, { ...view, live: false, pane: 'history' })).toEqual({
      result: 'done',
      note: '',
      notify: false
    })
    expect(settleOf(run, { ...view, pane: 'gone' })?.result).toBe('failed')
    expect(settleOf(run, { ...view, exited: true, quiet: false })).toMatchObject({
      result: 'failed',
      notify: false
    })
    // Only running runs with a chat are settled.
    expect(settleOf({ ...run, result: 'done' }, view)).toBeNull()
    expect(settleOf({ ...run, paneId: null }, view)).toBeNull()
  })
})
