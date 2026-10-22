// The Usage screen and its top-bar button. Limits first, as claude words them (current
// session, weekly), then what chat turns cost: one sentence, a daily column chart and two
// tables. Quiet on purpose: grey until a limit gets close, color only when it matters.
import { useEffect, useState, type CSSProperties } from 'react'
import {
  RANGE_DAYS,
  liveWindow,
  summarizeUsage,
  type UsageRange,
  type UsageWindow
} from '@shared/usage'
import { useActions, useApp } from '../app/services'
import { fmtCost, fmtTokens, fmtUntil, limitAccountId, severity } from '../lib/usage-format'
import { IconGauge } from './icons'

function useTicker(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** "resets in 2h 13m" (minutes only: the screen updates every 30s) within a day; else the day. */
function resetLabel(at: number, now: number): string {
  const ms = at - now
  if (ms < 3_600_000) return `resets in ${Math.max(1, Math.ceil(ms / 60_000))}m`
  if (ms < 86_400_000) return `resets in ${fmtUntil(at, now)}`
  const when = new Date(at).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
  return `resets ${when}`
}

const turns = (n: number): string => `${n} ${n === 1 ? 'turn' : 'turns'}`

function LimitRow({ label, w, now }: { label: string; w: UsageWindow; now: number }) {
  const pct = Math.round(w.utilization * 100)
  const sev = severity(w.utilization)
  return (
    <div className={`ul-row sev-${sev}`}>
      <span className="ul-lbl">{label}</span>
      <span
        className="ul-bar"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="ul-fill" style={{ '--w': `${Math.min(100, pct)}%` } as CSSProperties} />
      </span>
      <span className="ul-pct">{pct}%</span>
      <span className="ul-reset">
        {resetLabel(w.resetsAt, now)}
        {sev === 'err' ? <span className="ul-warn"> · almost out</span> : null}
      </span>
    </div>
  )
}

/** Daily cost as quiet columns; the chosen range is darker, hovering a day names it. */
function DailyChart({
  daily,
  inRange
}: {
  daily: { day: string; costUsd: number }[]
  inRange: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...daily.map((d) => d.costUsd), 0.0001)
  const long = daily.length > 10
  const label = (d: string, o: Intl.DateTimeFormatOptions): string =>
    new Date(`${d}T12:00:00`).toLocaleDateString(undefined, o)
  const h = hover !== null ? daily[hover]! : null
  return (
    <figure className="uc">
      <figcaption className="uc-cap" aria-live="polite">
        {h ? (
          <>
            {label(h.day, { weekday: 'short', month: 'short', day: 'numeric' })} ·{' '}
            <b>{fmtCost(h.costUsd)}</b>
          </>
        ) : (
          'Cost per day'
        )}
      </figcaption>
      <div className="uc-cols" onMouseLeave={() => setHover(null)}>
        {daily.map((d, i) => (
          <span
            key={d.day}
            className={`uc-col${i >= daily.length - inRange ? ' in' : ''}${hover === i ? ' on' : ''}`}
            onMouseEnter={() => setHover(i)}
            title={`${label(d.day, { month: 'short', day: 'numeric' })}: ${fmtCost(d.costUsd)}`}
          >
            <span
              className="uc-bar"
              style={
                {
                  '--h': `${d.costUsd > 0 ? Math.max(3, (d.costUsd / max) * 100) : 0}%`
                } as CSSProperties
              }
            />
          </span>
        ))}
      </div>
      <div className="uc-axis" aria-hidden="true">
        {long ? (
          <>
            <span>{label(daily[0]!.day, { month: 'short', day: 'numeric' })}</span>
            <span>Today</span>
          </>
        ) : (
          daily.map((d, i) => (
            <span key={d.day}>
              {i === daily.length - 1 ? 'Today' : label(d.day, { weekday: 'narrow' })}
            </span>
          ))
        )}
      </div>
    </figure>
  )
}

const RANGES: { id: UsageRange; label: string; sentence: string }[] = [
  { id: 'today', label: 'Today', sentence: 'today' },
  { id: '7d', label: '7 days', sentence: 'in the last 7 days' },
  { id: '30d', label: '30 days', sentence: 'in the last 30 days' }
]

export function UsageView() {
  const actions = useActions()
  const usage = useApp((s) => s.usage)
  const accounts = useApp((s) => s.config.accounts)
  const workspaces = useApp((s) => s.config.workspaces)
  const info = useApp((s) => s.accountInfo)
  const defaultId = useApp((s) => s.config.settings.defaultAccountId)
  const [range, setRange] = useState<UsageRange>('7d')
  const now = useTicker(30_000)
  const sum = summarizeUsage(usage, range, now)
  const r = RANGES.find((x) => x.id === range)!

  useEffect(() => {
    void actions.loadUsage()
    // Once when the screen opens; finished turns refresh it after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const claude = accounts.filter((a) => a.cli === 'claude')
  const ordered = [
    ...claude.filter((a) => a.id === defaultId),
    ...claude.filter((a) => a.id !== defaultId)
  ]
  const wsName = (id: string | null): string =>
    workspaces.find((w) => w.id === id)?.name ?? 'Deleted project'
  // All accounts' days added up, oldest first.
  const perAccount = Object.values(sum.accounts)
  const series = perAccount[0]?.daily.map((p, i) => ({
    day: p.day,
    costUsd: perAccount.reduce((s, a) => s + (a.daily[i]?.costUsd ?? 0), 0)
  }))

  return (
    <div className="page u-page">
      <div className="page-in">
        <header className="u-head">
          <h1>Usage</h1>
          <div className="seg" role="radiogroup" aria-label="Range">
            {RANGES.map((x) => (
              <button
                key={x.id}
                className={`seg-btn${range === x.id ? ' on' : ''}`}
                role="radio"
                aria-checked={range === x.id}
                onClick={() => setRange(x.id)}
              >
                {x.label}
              </button>
            ))}
          </div>
        </header>

        <section className="u-sec" aria-labelledby="u-lim-h">
          <h2 id="u-lim-h">Plan limits</h2>
          {ordered.length === 0 ? (
            <p className="u-empty">Add a claude account to see its limits.</p>
          ) : null}
          {ordered.map((a) => {
            const lim = usage.limits[a.id]
            const five = liveWindow(lim?.fiveHour ?? null, now)
            const week = liveWindow(lim?.sevenDay ?? null, now)
            const plan = info[a.id]?.info?.plan
            return (
              <div key={a.id} className="u-acct" role="group" aria-label={`Account ${a.name}`}>
                <div className="u-acct-hd">
                  <b>{a.name}</b>
                  {plan ? <span>{plan}</span> : null}
                </div>
                {five ? <LimitRow label="Current session" w={five} now={now} /> : null}
                {week ? <LimitRow label="Weekly" w={week} now={now} /> : null}
                {!five && !week ? (
                  <p className="u-empty">Shows after this account&apos;s next chat turn.</p>
                ) : null}
              </div>
            )
          })}
        </section>

        <section className="u-sec" aria-labelledby="u-spend-h">
          <h2 id="u-spend-h">Spend</h2>
          <p className="u-sum">
            <b>{fmtCost(sum.total.costUsd)}</b> over {turns(sum.total.turns)} and{' '}
            {fmtTokens(sum.total.tokens)} tokens {r.sentence}.
          </p>
          {series ? <DailyChart daily={series} inRange={RANGE_DAYS[range]} /> : null}

          {sum.projects.length ? (
            <table className="u-tbl">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Turns</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {sum.projects.map((p) => (
                  <tr key={p.workspaceId ?? '-'}>
                    <td>{wsName(p.workspaceId)}</td>
                    <td>{p.turns}</td>
                    <td>{fmtTokens(p.tokens)}</td>
                    <td>{fmtCost(p.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="u-empty">No chat turns {r.sentence}.</p>
          )}

          {sum.chats.length ? (
            <table className="u-tbl">
              <thead>
                <tr>
                  <th>Chat</th>
                  <th>Project</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {sum.chats.map((c) => (
                  <tr key={c.paneId}>
                    <td>{c.title || 'Untitled chat'}</td>
                    <td className="u-dim">{wsName(c.workspaceId)}</td>
                    <td>{fmtCost(c.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

        <p className="u-note">
          Limits are what claude reported after its last turn. Cost is at API prices: on Pro or Max
          you pay your plan, not this. Terminal panes are not measured.
        </p>
      </div>
    </div>
  )
}

export interface SessionLimit {
  /** The account the limit belongs to; named when there is more than one claude account. */
  account: { id: string; name: string } | null
  named: boolean
  pct: number | null
  sev: ReturnType<typeof severity>
}

/** The session limit of the focused chat's account (else the default one), when known. */
export function useSessionLimit(): SessionLimit {
  const id = useApp((s) => limitAccountId(s.config, s.focusedPaneId))
  const name = useApp((s) => s.config.accounts.find((a) => a.id === id)?.name ?? null)
  const named = useApp((s) => s.config.accounts.filter((a) => a.cli === 'claude').length > 1)
  const lim = useApp((s) => (id ? s.usage.limits[id] : undefined))
  const now = useTicker(60_000)
  const five = liveWindow(lim?.fiveHour ?? null, now)
  return {
    account: id && name ? { id, name } : null,
    named,
    pct: five ? Math.round(five.utilization * 100) : null,
    sev: five ? severity(five.utilization) : 'ok'
  }
}

/** "work: 42% of the current session limit", or why there is no number. */
export function sessionLimitLabel(l: SessionLimit): string {
  const who = l.named && l.account ? `${l.account.name}: ` : ''
  if (l.pct !== null) return `Usage: ${who}${l.pct}% of the current session limit`
  return l.named && l.account
    ? `Usage: no limits from ${l.account.name} yet (they show after its first chat turn)`
    : 'Usage'
}

/** The top-bar button: a gauge and the session limit ("42%", "work · 42%"), or "Usage". */
export function UsageButton() {
  const actions = useActions()
  const on = useApp((s) => s.view === 'usage')
  const limit = useSessionLimit()
  const label = sessionLimitLabel(limit)
  const pct = limit.pct !== null ? `${limit.pct}%` : null
  const text =
    limit.named && limit.account ? (
      <>
        <span className="u-pill-who">{limit.account.name}</span>
        <span aria-hidden="true">·</span>
        {pct ?? '–'}
      </>
    ) : (
      (pct ?? 'Usage')
    )
  return (
    <button
      className={`u-pill sev-${limit.sev}${on ? ' on' : ''}`}
      aria-label={label}
      title={label}
      aria-current={on ? 'page' : undefined}
      onClick={() => actions.setView(on ? 'grid' : 'usage')}
    >
      <IconGauge small />
      {text}
    </button>
  )
}
