// Scheduled chats (#77): when a job runs next, and what to do when it is due. Times are local
// wall-clock ("09:00" on the chosen days), worked out with the machine's own calendar, so a
// daylight-saving change keeps 09:00 at 09:00. Pure: the renderer runs jobs, main only wakes
// the window when one is due.
import type { ChatEffort, ChatMode } from './chat'

export const SCHEDULES_MAX = 30
export const SCHEDULE_RUNS_MAX = 20
/** A run found later than this (asleep, app closed) is recorded as missed, not run. */
export const MISSED_AFTER_MS = 60 * 60 * 1000

export type ScheduleWhen =
  /** Once, at a local date and time (`2026-10-27T09:00`). */
  | { kind: 'once'; at: string }
  /** On the chosen weekdays (0 = Sunday) at a local time; all seven = daily. */
  | { kind: 'weekly'; days: number[]; time: string }
  /** Every N hours, counted from a local time each day. */
  | { kind: 'hours'; every: number; from: string }
  /** When the account's 5-hour or weekly limit resets. */
  | { kind: 'reset'; window: 'fiveHour' | 'sevenDay' }

export type RunResult = 'running' | 'done' | 'failed' | 'missed' | 'skipped' | 'waiting'

export interface ScheduleRun {
  at: number
  result: RunResult
  /** The chat it ran in, to open from the page. */
  paneId: string | null
  note: string
}

export interface ScheduledJob {
  id: string
  wsId: string
  accountId: string
  prompt: string
  model: string | null
  effort: ChatEffort | null
  chatMode: ChatMode | null
  when: ScheduleWhen
  /** A new chat in the project, or the chat with this pane id (open or in History). */
  target: { kind: 'new' } | { kind: 'chat'; paneId: string }
  /** At the limit: wait for the reset, or let "Switch account at limit" carry it. */
  atLimit: 'wait' | 'switch'
  enabled: boolean
  /** "Send later" (#77): one message for one chat, removed once it is sent. */
  oneShot: boolean
  /** When it runs next (ms); null: not known yet (a reset not reported) or never again. */
  nextAt: number | null
  runs: ScheduleRun[]
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
export const TIME_PATTERN = HHMM
export const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/

function atTime(day: Date, time: string): Date {
  const m = HHMM.exec(time)
  const d = new Date(day)
  d.setHours(m ? Number(m[1]) : 9, m ? Number(m[2]) : 0, 0, 0)
  return d
}

/** A local `YYYY-MM-DDTHH:mm` as ms; NaN when malformed. */
export function parseLocal(at: string): number {
  if (!LOCAL_DATETIME_PATTERN.test(at)) return NaN
  const [date, time] = at.split('T') as [string, string]
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  return atTime(new Date(y, mo - 1, d), time).getTime()
}

/** ms as a local `YYYY-MM-DDTHH:mm`, for the date field. */
export function toLocal(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * The first time strictly after `after` that the job runs; null for a past one-off or a reset
 * not known yet. `resetAt`: the account window's reset time, for `reset` jobs.
 */
export function nextRun(
  when: ScheduleWhen,
  after: number,
  resetAt: number | null = null
): number | null {
  switch (when.kind) {
    case 'once': {
      const t = parseLocal(when.at)
      return Number.isFinite(t) && t > after ? t : null
    }
    case 'weekly': {
      if (!when.days.length) return null
      const start = new Date(after)
      // Day by day (not +24h), so a daylight-saving day still lands on the wall time.
      for (let i = 0; i <= 7; i++) {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
        if (!when.days.includes(day.getDay())) continue
        const t = atTime(day, when.time).getTime()
        if (t > after) return t
      }
      return null
    }
    case 'hours': {
      const every = Math.min(24, Math.max(1, Math.round(when.every)))
      const start = new Date(after)
      for (let i = -1; i <= 1; i++) {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
        const first = atTime(day, when.from)
        for (let h = 0; h < 24; h += every) {
          const t = new Date(first)
          t.setHours(first.getHours() + h)
          // Only that day's slots; the next day starts again at `from`.
          if (t.getDate() !== first.getDate() && h > 0) break
          if (t.getTime() > after) return t.getTime()
        }
      }
      return null
    }
    case 'reset':
      return resetAt !== null && resetAt > after ? resetAt : null
  }
}

/** What to do with a job now: run it, record a missed run, or nothing yet. */
export function dueAction(
  job: Pick<ScheduledJob, 'enabled' | 'nextAt'>,
  now: number
): 'run' | 'missed' | null {
  if (!job.enabled || job.nextAt === null || now < job.nextAt) return null
  return now - job.nextAt > MISSED_AFTER_MS ? 'missed' : 'run'
}

/** The job with a run added, keeping the newest `SCHEDULE_RUNS_MAX`. */
export function withRun<J extends Pick<ScheduledJob, 'runs'>>(job: J, run: ScheduleRun): J {
  return { ...job, runs: [run, ...job.runs].slice(0, SCHEDULE_RUNS_MAX) }
}

/** What the renderer sees of a running run's chat when it checks whether the run is over. */
export interface RunView {
  /** Started by this launch (a run left `running` by an earlier one is stale, #117). */
  live: boolean
  pane: 'open' | 'history' | 'gone'
  exited: boolean
  /** Its message was sent and the chat is idle again (not busy, no background work). */
  quiet: boolean
  now: number
}

/**
 * How a `running` run ends, or null while it goes on. Only a run this launch started can say
 * "done" out loud: a stale one is settled quietly, so later chat activity never finishes it.
 */
export function settleOf(
  run: ScheduleRun,
  v: RunView
): { result: RunResult; note: string; notify: boolean } | null {
  if (run.result !== 'running' || !run.paneId) return null
  if (v.pane === 'gone') return { result: 'failed', note: 'that chat is gone', notify: false }
  if (v.pane === 'history') return { result: 'done', note: run.note, notify: false }
  if (!v.live)
    return {
      result: 'failed',
      note: 'interrupted: Wraithgrid closed during the run',
      notify: false
    }
  if (v.exited) return { result: 'failed', note: run.note, notify: false }
  if (v.quiet && v.now - run.at > 10_000) return { result: 'done', note: run.note, notify: true }
  return null
}

/** The soonest run of any enabled job, for main to wake a closed window in time. */
export function soonestRun(
  jobs: readonly Pick<ScheduledJob, 'enabled' | 'nextAt'>[]
): number | null {
  let best: number | null = null
  for (const j of jobs)
    if (j.enabled && j.nextAt !== null && (best === null || j.nextAt < best)) best = j.nextAt
  return best
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "weekdays 09:00", "daily 18:30", "Mon, Thu 09:00", "every 6 hours", "work limit resets". */
export function describeWhen(when: ScheduleWhen, accountName = 'the account'): string {
  switch (when.kind) {
    case 'once': {
      const t = parseLocal(when.at)
      return Number.isFinite(t) ? `once ${fmtDay(t)} ${when.at.slice(11)}` : 'once'
    }
    case 'weekly': {
      const days = [...when.days].sort()
      if (days.length === 7) return `daily ${when.time}`
      if (days.join() === '1,2,3,4,5') return `weekdays ${when.time}`
      return `${days.map((d) => DAY[d]).join(', ')} ${when.time}`
    }
    case 'hours':
      return when.every === 1 ? 'every hour' : `every ${when.every} hours`
    case 'reset':
      return `${accountName} ${when.window === 'fiveHour' ? '5-hour' : 'weekly'} limit resets`
  }
}

/** "Mon 27 Oct". */
export function fmtDay(ms: number): string {
  const d = new Date(ms)
  return `${DAY[d.getDay()]} ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`
}

/** "Mon 09:00", or "09:00" when it is today. */
export function fmtWhen(ms: number, now: number): string {
  const d = new Date(ms)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return new Date(now).toDateString() === d.toDateString() ? hm : `${DAY[d.getDay()]} ${hm}`
}
