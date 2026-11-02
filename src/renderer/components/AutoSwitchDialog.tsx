// Before a chat at its account's limit switches account (#161): the two accounts with their
// use, what carries over, and Switch / Stay. One question at a time, oldest first, and only
// while no other dialog is open; a pane closed or switched by hand meanwhile drops its question.
import { useEffect, useState } from 'react'
import { AGENT_CLI_LABEL } from '@shared/agent-clis'
import type { Account } from '@shared/types'
import type { AccountLimits } from '@shared/usage'
import { useActions, useApp } from '../app/services'
import { accountById, findPane, type SwitchAsk } from '../app/store'
import { peakUse } from '../lib/auto-switch'
import { Dialog } from './Dialog'
import { ProviderLogo } from './ProviderLogo'
import { resetLabel, useTicker } from './UsageView'

export function AutoSwitchDialog() {
  const actions = useActions()
  const ask = useApp((s) => (s.modal ? null : (s.switchAsks[0] ?? null)))
  const stale = useApp((s) => {
    if (!ask) return false
    const pane = findPane(s.config, ask.paneId)?.pane
    return !pane || pane.accountId !== ask.fromId
  })
  useEffect(() => {
    if (ask && stale) actions.answerSwitch(ask.paneId, 'stay')
  }, [ask, stale, actions])
  if (!ask || stale) return null
  // Keyed: "Don't ask again" starts unticked for each question.
  return <Question key={`${ask.paneId}:${ask.toId}`} ask={ask} />
}

function Question({ ask }: { ask: SwitchAsk }) {
  const actions = useActions()
  const from = useApp((s) => accountById(s.config, ask.fromId))
  const to = useApp((s) => accountById(s.config, ask.toId))
  const title = useApp((s) => findPane(s.config, ask.paneId)?.pane.title ?? '')
  const limits = useApp((s) => s.usage.limits)
  const now = useTicker(30_000)
  const [dontAsk, setDontAsk] = useState(false)
  if (!from) return null
  const stay = (): void => actions.answerSwitch(ask.paneId, 'stay')
  const peak = peakUse(limits[from.id], now)
  const win = peak?.window === 'weekly' ? limits[from.id]?.sevenDay : limits[from.id]?.fiveHour
  const resets = win ? resetLabel(win.resetsAt, now) : null

  return (
    <Dialog onClose={stay} className="w4 as-dlg" role="alertdialog" labelledBy="as-t">
      <div className="dlg-hd">
        <h2 id="as-t">{to ? `Switch to ${to.name}?` : 'No account has room'}</h2>
        <p className="as-lead">
          {ask.reason}
          {title ? <span className="as-where"> · in “{title}”</span> : null}
        </p>
      </div>
      <div className="dlg-bd">
        {to ? (
          <>
            <div className="as-flow">
              <Side a={from} label="now" foot={resets ?? ''} limits={limits} now={now} />
              <span className="as-arrow" aria-hidden="true">
                →
              </span>
              <Side a={to} label="next" limits={limits} now={now} />
            </div>
            <ul className="sw-notes">
              <li>The whole conversation is copied over.</li>
              <li>
                {ask.resend
                  ? 'Your last message is sent again.'
                  : 'Nothing is sent again: the last answer finished.'}
              </li>
              <li>Same model and settings.</li>
            </ul>
          </>
        ) : (
          <p>
            No other {AGENT_CLI_LABEL[from.cli]} account has room.
            {resets ? ` ${from.name} ${resets}.` : ''}
          </p>
        )}
      </div>
      <div className="dlg-ft">
        {to ? (
          <>
            <label className="as-dont">
              <input
                type="checkbox"
                checked={dontAsk}
                onChange={(e) => setDontAsk(e.target.checked)}
              />
              Don’t ask again
            </label>
            <button className="btn gh" onClick={stay}>
              Stay
            </button>
            <button
              className="btn pri"
              data-autofocus
              onClick={() => actions.answerSwitch(ask.paneId, 'switch', dontAsk)}
            >
              {ask.resend ? 'Switch & resend' : 'Switch'}
            </button>
          </>
        ) : (
          <button className="btn pri" data-autofocus onClick={stay}>
            OK
          </button>
        )}
      </div>
    </Dialog>
  )
}

/** One account: its fuller window now, as a bar; `foot` the reset (from) or what is left (to). */
function Side({
  a,
  label,
  foot,
  limits,
  now
}: {
  a: Account
  label: string
  foot?: string
  limits: Record<string, AccountLimits>
  now: number
}) {
  const peak = peakUse(limits[a.id], now)
  const pct = peak?.pct ?? null
  return (
    <div className="as-side">
      <div className="as-acct">
        <ProviderLogo cli={a.cli} fallbackName={a.name} />
        <span className="as-nm">{a.name}</span>
      </div>
      <div className="as-use mono">
        {pct === null ? 'usage not known yet' : `${pct}% · ${peak!.window}`}
      </div>
      <span
        className={`account-bar as-bar${pct !== null && pct >= 95 ? ' full' : pct !== null && pct >= 80 ? ' hot' : ''}`}
      >
        <i style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </span>
      <div className="as-meta mono">
        <span>{label}</span>
        <span>{foot ?? (pct === null ? '' : `${100 - pct}% left`)}</span>
      </div>
    </div>
  )
}
