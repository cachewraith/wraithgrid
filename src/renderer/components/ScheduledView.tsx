// Scheduled chats (#77): the jobs with their next and last run, and the dialog that makes one.
import { useState, type MouseEvent } from 'react'
import { AGENT_CLI_SPECS } from '@shared/agent-clis'
import { CHAT_EFFORTS, CHAT_MODES, CHAT_MODE_LABEL, CHAT_MODEL_PATTERN } from '@shared/chat'
import {
  describeWhen,
  fmtWhen,
  nextRun,
  parseLocal,
  toLocal,
  type RunResult,
  type ScheduledJob,
  type ScheduleWhen
} from '@shared/schedule'
import { useActions, useApp } from '../app/services'
import { newId } from '../lib/ids'
import { ago } from '../lib/time'
import { fmtUntil } from '../lib/usage-format'
import { ContextMenu, menuPoint, type MenuPoint } from './ContextMenu'
import { Dialog } from './Dialog'
import { ProjectIcon } from './ProjectIcon'
import { ProviderLogo } from './ProviderLogo'
import { IconMore, IconPlus } from './icons'
import { useNow } from './ProjectView'

const RESULT_TONE: Record<RunResult, string> = {
  running: 'working',
  done: 'ok',
  failed: 'bad',
  missed: 'bad',
  skipped: 'warn',
  waiting: 'warn'
}

export function ScheduledView() {
  const actions = useActions()
  const all = useApp((s) => s.config.schedules)
  const jobs = all.filter((j) => !j.oneShot)
  const queued = all.filter((j) => j.oneShot)
  const workspaces = useApp((s) => s.config.workspaces)
  const accounts = useApp((s) => s.config.accounts)
  const now = useNow()
  const [menu, setMenu] = useState<{ at: MenuPoint; job: ScheduledJob } | null>(null)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const openMenu = (job: ScheduledJob) => (e: MouseEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ at: menuPoint(e), job })
  }

  return (
    <div className="page sch-page">
      <div className="pj">
        <header className="pj-hd">
          <div>
            <h1>Scheduled</h1>
            <p>Runs while Wraithgrid or its tray icon is open · times in {zone}</p>
          </div>
          <button
            className="btn pri"
            onClick={() => actions.openModal({ kind: 'job', jobId: null })}
          >
            <IconPlus small />
            New job
          </button>
        </header>
        {queued.length ? (
          <section className="sch-q" aria-label="Queued messages">
            <h2 className="pj-h">Queued messages</h2>
            <div className="sch-list">
              {queued.map((j) => {
                const paneId = j.target.kind === 'chat' ? j.target.paneId : ''
                const ws = workspaces.find((w) => w.id === j.wsId)
                const title = ws?.panes.find((p) => p.id === paneId)?.title ?? 'a chat'
                return (
                  <div key={j.id} className="sch-row sch-qrow">
                    <div className="sch-main">
                      <div className="sch-t">{j.prompt.split('\n')[0]}</div>
                      <div className="sch-where">
                        <span>{ws?.name ?? 'project missing'}</span>·<span>“{title}”</span>
                      </div>
                    </div>
                    <div className="sch-cell">
                      <span className="sch-k">Sends</span>
                      <span className="sch-m">
                        {j.nextAt === null
                          ? 'after the reset'
                          : `${fmtWhen(j.nextAt, now)} · ${j.nextAt > now ? `in ${fmtUntil(j.nextAt, now)}` : 'now'}`}
                      </span>
                    </div>
                    <button className="btn sm gh" onClick={() => actions.deleteJob(j.id)}>
                      Cancel
                    </button>
                    <button className="btn sm" onClick={() => actions.runJobNow(j.id)}>
                      Send now
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}
        {jobs.length === 0 ? (
          <div className="pj-empty">
            <h2>No scheduled chats</h2>
            <p>Start chats on a schedule, or when a limit resets.</p>
          </div>
        ) : (
          <div className="sch-list" role="list" aria-label="Scheduled jobs">
            {jobs.map((j) => {
              const ws = workspaces.find((w) => w.id === j.wsId)
              const account = accounts.find((a) => a.id === j.accountId)
              const last = j.runs[0]
              const target =
                j.target.kind === 'new'
                  ? 'new chat'
                  : `continues “${
                      ws?.panes.find((p) => p.id === (j.target as { paneId: string }).paneId)
                        ?.title ??
                      ws?.history.find((h) => h.pane.id === (j.target as { paneId: string }).paneId)
                        ?.pane.title ??
                      'a chat'
                    }”`
              return (
                <div
                  key={j.id}
                  role="listitem"
                  className={`sch-row${j.enabled ? '' : ' off'}`}
                  onClick={() => actions.openModal({ kind: 'job', jobId: j.id })}
                  onContextMenu={openMenu(j)}
                >
                  <div className="sch-main">
                    <div className="sch-t">{j.prompt.split('\n')[0]}</div>
                    <div className="sch-where">
                      {ws ? <ProjectIcon icon={ws.icon} size={14} /> : null}
                      <span>{ws?.name ?? 'project missing'}</span>·
                      {account ? (
                        <ProviderLogo cli={account.cli} fallbackName={account.name} size={12} />
                      ) : null}
                      <span>{account?.name ?? 'account missing'}</span>·<span>{target}</span>
                      {j.chatMode ? (
                        <span>· {CHAT_MODE_LABEL[j.chatMode].toLowerCase()}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="sch-cell">
                    <span className="sch-k">When</span>
                    <span className="sch-m">{describeWhen(j.when, account?.name)}</span>
                  </div>
                  <div className="sch-cell">
                    <span className="sch-k">Next</span>
                    <span className="sch-m">
                      {!j.enabled
                        ? 'off'
                        : j.nextAt === null
                          ? j.when.kind === 'reset'
                            ? 'after the reset'
                            : '–'
                          : `${fmtWhen(j.nextAt, now)} · ${j.nextAt > now ? `in ${fmtUntil(j.nextAt, now)}` : 'now'}`}
                    </span>
                  </div>
                  <div className="sch-cell">
                    <span className="sch-k">Last</span>
                    <span className="sch-m" title={last?.note || undefined}>
                      {last ? (
                        <>
                          <span className={`sch-r ${RESULT_TONE[last.result]}`}>{last.result}</span>
                          {' · '}
                          {last.note && last.result !== 'done' ? last.note : ago(last.at, now)}
                        </>
                      ) : (
                        '–'
                      )}
                    </span>
                  </div>
                  <button
                    className={`sw${j.enabled ? ' on' : ''}`}
                    role="switch"
                    aria-checked={j.enabled}
                    aria-label={j.enabled ? 'Turn off' : 'Turn on'}
                    onClick={(e) => {
                      e.stopPropagation()
                      actions.setJobEnabled(j.id, !j.enabled)
                    }}
                  ></button>
                  <button
                    className="icon-btn sm"
                    aria-label={`Job actions: ${j.prompt.split('\n')[0]}`}
                    aria-haspopup="menu"
                    onClick={openMenu(j)}
                  >
                    <IconMore small />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {menu ? (
        <ContextMenu
          at={menu.at}
          label="Job"
          onClose={() => setMenu(null)}
          items={[
            { label: 'Run now', onSelect: () => actions.runJobNow(menu.job.id) },
            {
              label: 'Edit',
              onSelect: () => actions.openModal({ kind: 'job', jobId: menu.job.id })
            },
            {
              label: 'Duplicate',
              onSelect: () =>
                actions.saveJob({ ...menu.job, id: newId('j'), runs: [], nextAt: null })
            },
            ...(menu.job.runs.find((r) => r.paneId)
              ? [
                  {
                    label: 'Open last chat',
                    onSelect: () => {
                      const id = menu.job.runs.find((r) => r.paneId)!.paneId!
                      if (workspaces.some((w) => w.panes.some((p) => p.id === id)))
                        actions.revealPane(id)
                      else actions.reopenChat(menu.job.wsId, id)
                    }
                  }
                ]
              : []),
            {
              label: 'Delete',
              danger: true,
              divider: true,
              onSelect: () => actions.deleteJob(menu.job.id)
            }
          ]}
        />
      ) : null}
    </div>
  )
}

type WhenKind = 'once' | 'daily' | 'weekly' | 'hours' | 'reset'
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function kindOf(w: ScheduleWhen): WhenKind {
  if (w.kind === 'weekly') return w.days.length === 7 ? 'daily' : 'weekly'
  return w.kind
}

/** New job, or edit one: project, account, prompt, when, where, model/effort/mode. */
export function JobDialog({ jobId }: { jobId: string | null }) {
  const actions = useActions()
  const existing = useApp((s) => s.config.schedules.find((j) => j.id === jobId) ?? null)
  const workspaces = useApp((s) => s.config.workspaces)
  const accounts = useApp((s) => s.config.accounts)
  const activeWs = useApp((s) => s.config.activeWorkspace)
  const [now] = useState(() => Date.now())
  const [job, setJob] = useState<ScheduledJob>(
    () =>
      existing ?? {
        id: newId('j'),
        wsId: activeWs,
        accountId: workspaces.find((w) => w.id === activeWs)?.accountId ?? accounts[0]?.id ?? '',
        prompt: '',
        model: null,
        effort: null,
        chatMode: null,
        when: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' },
        target: { kind: 'new' },
        atLimit: 'wait',
        enabled: true,
        oneShot: false,
        nextAt: null,
        runs: []
      }
  )
  const set = (patch: Partial<ScheduledJob>): void => setJob((j) => ({ ...j, ...patch }))
  const kind = kindOf(job.when)
  const setKind = (k: WhenKind): void => {
    const time = job.when.kind === 'weekly' ? job.when.time : '09:00'
    set({
      when:
        k === 'once'
          ? { kind: 'once', at: toLocal(now + 3600_000).slice(0, 14) + '00' }
          : k === 'daily'
            ? { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time }
            : k === 'weekly'
              ? { kind: 'weekly', days: [1, 2, 3, 4, 5], time }
              : k === 'hours'
                ? { kind: 'hours', every: 6, from: '09:00' }
                : { kind: 'reset', window: 'fiveHour' }
    })
  }
  const ws = workspaces.find((w) => w.id === job.wsId)
  const chats = ws ? [...ws.panes, ...ws.history.map((h) => h.pane)].filter((p) => !p.shell) : []
  const modelOk = !job.model || CHAT_MODEL_PATTERN.test(job.model)
  const whenOk =
    job.when.kind === 'once'
      ? Number.isFinite(parseLocal(job.when.at)) && parseLocal(job.when.at) > now
      : job.when.kind === 'weekly'
        ? job.when.days.length > 0
        : true
  const ok = !!ws && !!job.accountId && job.prompt.trim() !== '' && modelOk && whenOk
  const upcoming: number[] = []
  if (job.when.kind !== 'reset') {
    let t: number | null = now
    for (let i = 0; i < 3 && t !== null; i++) {
      t = nextRun(job.when, t)
      if (t !== null) upcoming.push(t)
    }
  }
  const time = job.when.kind === 'weekly' ? job.when.time : null

  return (
    <Dialog onClose={actions.closeModal} labelledBy="job-t" className="job-dlg">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!ok) return
          actions.saveJob({ ...job, prompt: job.prompt.trim() })
          actions.closeModal()
        }}
      >
        <div className="dlg-hd">
          <h2 id="job-t">{existing ? 'Edit scheduled job' : 'New scheduled job'}</h2>
        </div>
        <div className="dlg-bd job-grid">
          <label className="team-f">
            <span>Project</span>
            <select
              className="inpt sans"
              value={job.wsId}
              onChange={(e) => set({ wsId: e.target.value, target: { kind: 'new' } })}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="team-f">
            <span>Account</span>
            <select
              className="inpt sans"
              value={job.accountId}
              onChange={(e) => set({ accountId: e.target.value })}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {AGENT_CLI_SPECS[a.cli].label}
                </option>
              ))}
            </select>
          </label>
          <label className="team-f job-wide">
            <span>Prompt</span>
            <textarea
              className="inpt sans"
              rows={3}
              maxLength={8000}
              autoFocus
              value={job.prompt}
              placeholder="Review the open PRs in this repo and list which ones need me."
              onChange={(e) => set({ prompt: e.target.value })}
            />
          </label>
          <div className="team-f job-wide">
            <span>When</span>
            <div className="seg job-seg" role="radiogroup" aria-label="When">
              {(
                [
                  ['once', 'Once'],
                  ['daily', 'Daily'],
                  ['weekly', 'Weekly'],
                  ['hours', 'Every N hours'],
                  ['reset', 'Limit resets']
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  className={`seg-btn${kind === k ? ' on' : ''}`}
                  onClick={() => setKind(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {job.when.kind === 'once' ? (
            <label className="team-f">
              <span>Date and time</span>
              <input
                type="datetime-local"
                className="inpt sans"
                value={job.when.at}
                onChange={(e) => set({ when: { kind: 'once', at: e.target.value } })}
              />
            </label>
          ) : null}
          {kind === 'weekly' && job.when.kind === 'weekly' ? (
            <div className="team-f">
              <span>Days</span>
              <div className="job-days" role="group" aria-label="Days">
                {DAYS.map((d, i) => {
                  const days = (job.when as { days: number[] }).days
                  const on = days.includes(i)
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      className={on ? 'on' : ''}
                      onClick={() =>
                        set({
                          when: {
                            kind: 'weekly',
                            time: time ?? '09:00',
                            days: on ? days.filter((x) => x !== i) : [...days, i].sort()
                          }
                        })
                      }
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
          {job.when.kind === 'weekly' ? (
            <label className="team-f">
              <span>Time</span>
              <input
                type="time"
                className="inpt sans"
                value={job.when.time}
                onChange={(e) =>
                  set({
                    when: {
                      kind: 'weekly',
                      days: (job.when as { days: number[] }).days,
                      time: e.target.value || '09:00'
                    }
                  })
                }
              />
            </label>
          ) : null}
          {job.when.kind === 'hours' ? (
            <>
              <label className="team-f">
                <span>Every (hours)</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  className="inpt sans"
                  value={job.when.every}
                  onChange={(e) =>
                    set({
                      when: {
                        kind: 'hours',
                        from: (job.when as { from: string }).from,
                        every: Math.min(24, Math.max(1, Number(e.target.value) || 1))
                      }
                    })
                  }
                />
              </label>
              <label className="team-f">
                <span>Starting at</span>
                <input
                  type="time"
                  className="inpt sans"
                  value={job.when.from}
                  onChange={(e) =>
                    set({
                      when: {
                        kind: 'hours',
                        every: (job.when as { every: number }).every,
                        from: e.target.value || '09:00'
                      }
                    })
                  }
                />
              </label>
            </>
          ) : null}
          {job.when.kind === 'reset' ? (
            <label className="team-f">
              <span>Which limit</span>
              <select
                className="inpt sans"
                value={job.when.window}
                onChange={(e) =>
                  set({
                    when: { kind: 'reset', window: e.target.value as 'fiveHour' | 'sevenDay' }
                  })
                }
              >
                <option value="fiveHour">5-hour</option>
                <option value="sevenDay">Weekly</option>
              </select>
            </label>
          ) : null}
          <label className="team-f">
            <span>Where</span>
            <select
              className="inpt sans"
              value={job.target.kind === 'new' ? '' : job.target.paneId}
              onChange={(e) =>
                set({
                  target: e.target.value
                    ? { kind: 'chat', paneId: e.target.value }
                    : { kind: 'new' }
                })
              }
            >
              <option value="">New chat in the project</option>
              {chats.map((p) => (
                <option key={p.id} value={p.id}>
                  Continue “{p.title}”
                </option>
              ))}
            </select>
          </label>
          <div className="team-f job-wide team-3">
            <label className="team-f">
              <span>Model</span>
              <input
                className="inpt sans"
                value={job.model ?? ''}
                placeholder="default"
                aria-invalid={!modelOk}
                onChange={(e) => set({ model: e.target.value.trim() || null })}
              />
            </label>
            <label className="team-f">
              <span>Effort</span>
              <select
                className="inpt sans"
                value={job.effort ?? ''}
                onChange={(e) =>
                  set({ effort: (e.target.value || null) as ScheduledJob['effort'] })
                }
              >
                <option value="">default</option>
                {CHAT_EFFORTS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="team-f">
              <span>Mode</span>
              <select
                className="inpt sans"
                value={job.chatMode ?? 'default'}
                onChange={(e) =>
                  set({
                    chatMode:
                      e.target.value === 'default'
                        ? null
                        : (e.target.value as ScheduledJob['chatMode'])
                  })
                }
              >
                {CHAT_MODES.map((x) => (
                  <option key={x} value={x}>
                    {CHAT_MODE_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {job.chatMode === 'bypassPermissions' ? (
            <p className="job-wide team-warn job-note">
              Runs every tool without asking, unattended.
            </p>
          ) : null}
          <fieldset className="team-f job-wide team-folder">
            <legend>If the account is at its limit</legend>
            <label>
              <input
                type="radio"
                name="job-limit"
                checked={job.atLimit === 'wait'}
                onChange={() => set({ atLimit: 'wait' })}
              />
              <span>Wait for the reset</span>
            </label>
            <label>
              <input
                type="radio"
                name="job-limit"
                checked={job.atLimit === 'switch'}
                onChange={() => set({ atLimit: 'switch' })}
              />
              <span>
                Let “Switch account at limit” carry it to another account
                <small>Only when that setting is on; never another account otherwise.</small>
              </span>
            </label>
          </fieldset>
          {upcoming.length ? (
            <p className="job-wide job-note">
              Next runs: {upcoming.map((t) => fmtWhen(t, now)).join(' · ')}
            </p>
          ) : null}
        </div>
        <div className="dlg-ft">
          <button type="button" className="btn gh" onClick={actions.closeModal}>
            Cancel
          </button>
          <button type="submit" className="btn pri" disabled={!ok}>
            Save job
          </button>
        </div>
      </form>
    </Dialog>
  )
}
