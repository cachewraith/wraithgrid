// About (#124): the Updates card shows each install step (Download · Verify · Ready ·
// Restart), and What's new lists the versions beside the chosen one's notes: cards for New,
// a plain list for Fixed (from the notes' tables, never shown as tables).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { noteParts, releasePageUrl, type NoteParts } from '@shared/whats-new'
import { useActions, useApp, useServices } from '../app/services'
import { ago } from '../lib/time'
import { Markdown } from './chat/Markdown'
import { IconArrowUp, IconCheck, IconExport, IconImport, IconRestart, IconWarn } from './icons'
import { useNow } from './ProjectView'

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** "41.9 MB"; null when the size is not known yet. */
function fmtMB(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`
}

/** "web preview, …" → "Web preview, …": headings in WHATS-NEW.md start lower case. */
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Newer first: `1.10.0` above `1.9.2`; a version that doesn't parse sorts last. */
function newerFirst(a: string, b: string): number {
  const p = (v: string): number[] => v.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  const x = p(a)
  const y = p(b)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
  return 0
}

const Ok = () => (
  <span className="ab-ok">
    <IconCheck small />
  </span>
)
const Warn = () => (
  <span className="ab-warn">
    <IconWarn small />
  </span>
)

const STEPS = ['Download', 'Verify', 'Ready', 'Restart'] as const

/** The four install steps: `at` is the one in progress, earlier ones are done. */
function Steps({
  at,
  ready,
  percent,
  detail
}: {
  at: number
  ready: boolean
  percent: number
  detail: (i: number) => string
}) {
  return (
    <ol className="ab-steps" aria-label="Install steps">
      {STEPS.map((name, i) => {
        const done = i < at || (ready && i === at)
        const on = i === at && !done
        const width = done ? 100 : on ? (i === 0 ? percent : 100) : 0
        return (
          <li key={name} className={`ab-step${done ? ' did' : ''}${on ? ' on' : ''}`}>
            <span className="ab-sw">
              {done ? <IconCheck small /> : null}
              <span className={on ? 'ab-sweep' : undefined}>{name}</span>
            </span>
            <span className="ab-ln">
              <span style={{ '--w': `${width}%` } as CSSProperties} />
            </span>
            <span className="ab-sd">{detail(i)}</span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * One clear state at a time: up to date · available (its headlines) · downloading ·
 * verifying · ready to restart (Restart now / Later) · restarting · failed.
 */
export function UpdatesCard() {
  const { api } = useServices()
  const actions = useActions()
  const version = useApp((s) => s.info.version)
  const onLaunch = useApp((s) => s.config.settings.checkUpdatesOnLaunch)
  // macOS builds can't replace themselves (not Developer ID signed): straight to the page.
  const manualOnly = useApp((s) => s.info.platform === 'darwin')
  const { checking, result, install, installError } = useApp((s) => s.update)
  const anchor = useApp((s) => s.settingsAnchor)
  const now = useNow()
  const ref = useRef<HTMLDivElement>(null)
  const [later, setLater] = useState(false)

  useEffect(() => {
    if (anchor !== 'updates') return
    ref.current?.scrollIntoView({ block: 'center' })
    actions.clearSettingsAnchor()
  }, [anchor, actions])

  const latest = result?.status === 'available' ? result.latest : null
  const target =
    install.phase === 'downloading' || install.phase === 'ready' || install.phase === 'installing'
      ? install.version
      : (latest?.version ?? null)
  const openPage = (): void =>
    void api.shell.openExternal(latest?.url ?? releasePageUrl(target ?? version))
  const headlines = useMemo(
    () => (latest ? noteParts(latest.notes).added.slice(0, 4) : []),
    [latest]
  )

  let state: string
  let status: ReactNode
  let buttons: ReactNode = null
  let steps: ReactNode = null
  if (install.phase === 'checking') {
    state = 'preparing'
    status = <span className="ab-sweep">Preparing the update…</span>
    steps = <Steps at={0} ready={false} percent={0} detail={() => ''} />
  } else if (install.phase === 'downloading') {
    // electron-updater checks the file once it's all here: that's the Verify step.
    const verifying = install.percent >= 100
    state = 'downloading'
    const size = fmtMB(install.total)
    const done = fmtMB(install.transferred)
    status = (
      <span className="ab-sweep">
        {verifying ? 'Checking the download' : `Downloading ${install.version}`}
      </span>
    )
    steps = (
      <div
        role="progressbar"
        aria-label={`Downloading ${install.version}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={install.percent}
      >
        <Steps
          at={verifying ? 1 : 0}
          ready={false}
          percent={install.percent}
          detail={(i) =>
            i === 0
              ? size
                ? `${done ?? '0 MB'} / ${size}`
                : `${install.percent}%`
              : i === 1 && verifying
                ? 'checking…'
                : ''
          }
        />
      </div>
    )
    buttons = (
      <button className="btn gh" onClick={actions.cancelUpdate}>
        Cancel
      </button>
    )
  } else if (install.phase === 'ready') {
    state = 'ready'
    status = (
      <>
        <Ok />
        <span>
          {later
            ? `${install.version} is downloaded. Restart when you are ready.`
            : `${install.version} is downloaded. Restart Wraithgrid to finish; running panes close.`}
        </span>
      </>
    )
    steps = <Steps at={2} ready percent={100} detail={(i) => (i === 1 ? 'checked' : '')} />
    buttons = (
      <>
        {later ? null : (
          <button className="btn gh ab-in" onClick={() => setLater(true)}>
            Later
          </button>
        )}
        <button className="btn pri ab-in" onClick={() => void actions.restartToUpdate()}>
          <IconRestart />
          Restart now
        </button>
      </>
    )
  } else if (install.phase === 'installing') {
    state = 'installing'
    status = (
      <span className="ab-sweep">
        Installing {install.version}. Wraithgrid restarts when it is done.
      </span>
    )
    steps = <Steps at={3} ready={false} percent={100} detail={(i) => (i === 1 ? 'checked' : '')} />
  } else if (installError) {
    state = 'failed'
    status = (
      <>
        <Warn />
        <span>{installError.error}</span>
      </>
    )
    buttons = (
      <>
        {installError.manual ? null : (
          <button className="btn" onClick={() => void actions.installUpdate()}>
            <IconRestart />
            Retry
          </button>
        )}
        <button className="btn pri" onClick={openPage}>
          <IconImport />
          Open release page
        </button>
      </>
    )
  } else if (checking) {
    state = 'checking'
    status = <span className="ab-sweep">Checking GitHub for a newer release…</span>
  } else if (!result || result.status === 'skipped') {
    state = 'unchecked'
    status = <span>Not checked yet.</span>
  } else if (result.status === 'error') {
    state = 'check-failed'
    status = (
      <>
        <Warn />
        <span>{result.error}</span>
      </>
    )
  } else if (result.status === 'current') {
    state = 'current'
    status = (
      <>
        <Ok />
        <span>
          Up to date · checked{' '}
          {ago(result.checkedAt, now) === 'now' ? 'just now' : `${ago(result.checkedAt, now)} ago`}
        </span>
      </>
    )
  } else {
    state = 'available'
    const date = formatDate(result.latest.publishedAt)
    status = (
      <>
        <span className="ab-new">
          <IconArrowUp small />
        </span>
        <span>
          {result.latest.version} is out{date ? ` · ${date}` : ''}
        </span>
      </>
    )
    buttons = manualOnly ? (
      <button className="btn pri" onClick={openPage}>
        <IconImport />
        Open release page
      </button>
    ) : (
      <button className="btn pri" onClick={() => void actions.installUpdate()}>
        <IconImport />
        Download {result.latest.version}
      </button>
    )
  }
  const busy = install.phase !== 'idle'

  return (
    <section className="ab-upd" id="updates" ref={ref} data-state={state} aria-label="Updates">
      <div className="ab-top">
        <div className="ab-id">
          <span className="ab-k">Wraithgrid</span>
          <span className="ab-ver">
            {version}
            {target && target !== version ? (
              <>
                <span className="ab-ar"> → </span>
                {target}
              </>
            ) : null}
          </span>
          <div className="ab-state" role="status" aria-live="polite">
            {status}
          </div>
        </div>
        <div className="ab-act">
          {buttons}
          {busy || state === 'failed' ? null : (
            <button
              className="btn"
              disabled={checking}
              onClick={() => void actions.checkForUpdates('manual')}
            >
              <IconRestart />
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </div>
      </div>
      {steps}
      {state === 'available' && headlines.length ? (
        <div className="ab-in-ver">
          <span className="ab-k">In {latest!.version}</span>
          <ul>
            {headlines.map((h) => (
              <li key={h.name}>{h.name}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="ab-ft">
        <button
          className={`sw${onLaunch ? ' on' : ''}`}
          role="switch"
          aria-checked={onLaunch}
          aria-labelledby="upd-launch"
          onClick={() => actions.updateSettings({ checkUpdatesOnLaunch: !onLaunch })}
        />
        <span id="upd-launch">Check when Wraithgrid starts</span>
        <span className="ab-m">
          GitHub releases{manualOnly ? '' : ' · on Linux your password is asked for'}
        </span>
      </div>
    </section>
  )
}

interface Entry {
  version: string
  title: string
  date: string | null
  notes: string
  tag: 'new' | 'installed' | null
}

/** One version's notes: intro, New as cards, Fixed as a list. */
function VersionNotes({ e, parts, small }: { e: Entry; parts: NoteParts; small?: boolean }) {
  const date = formatDate(e.date)
  const title = cap(e.title || parts.title || '')
  return (
    <article
      className={`ab-note${small ? ' sub' : ''}`}
      aria-label={`Release notes for ${e.version}`}
    >
      <div className="ab-vh">
        <h3>
          {e.version}
          {small && title ? ` · ${title}` : ''}
        </h3>
        {date ? <span className="ab-m">{date}</span> : null}
      </div>
      {!small && title ? <p className="ab-vsub">{title}</p> : null}
      {parts.intro ? (
        <div className="ab-intro">
          <Markdown text={parts.intro} />
        </div>
      ) : null}
      {parts.added.length ? (
        <>
          <h4 className="ab-grp new">New</h4>
          <div className="ab-cards">
            {parts.added.map((it, i) => (
              <div key={i} className="ab-card">
                <h5>{it.name}</h5>
                <Markdown text={it.text} />
              </div>
            ))}
          </div>
        </>
      ) : null}
      {parts.fixed.length ? (
        <>
          <h4 className="ab-grp fix">Fixed</h4>
          <ul className="ab-fixes">
            {parts.fixed.map((it, i) => (
              <li key={i}>
                <b>{it.name}</b>
                <Markdown text={it.text} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  )
}

/** What's new: every known version on the left, the chosen one's notes on the right. */
export function WhatsNew() {
  const { api } = useServices()
  const notes = useApp((s) => s.update.notes)
  const version = useApp((s) => s.info.version)
  const result = useApp((s) => s.update.result)
  const [picked, setPicked] = useState<string | null>(null)

  const entries = useMemo<Entry[]>(() => {
    const out = new Map<string, Entry>()
    const latest = result?.status === 'available' ? result.latest : null
    if (latest)
      out.set(latest.version, {
        version: latest.version,
        title: noteParts(latest.notes).title ?? '',
        date: latest.publishedAt,
        notes: latest.notes,
        tag: 'new'
      })
    for (const n of [notes?.installed, ...(notes?.earlier ?? [])])
      if (n && !out.has(n.version))
        out.set(n.version, {
          ...n,
          tag: n.version === version ? 'installed' : null
        })
    // The installed version is listed even without notes, so it can say so.
    if (!out.has(version))
      out.set(version, { version, title: '', date: null, notes: '', tag: 'installed' })
    return [...out.values()].sort((a, b) => newerFirst(a.version, b.version))
  }, [notes, result, version])
  const parts = useMemo(
    () => new Map(entries.map((e) => [e.version, noteParts(e.notes)])),
    [entries]
  )
  if (!notes) return null

  const sel =
    entries.find((e) => e.version === picked) ??
    entries.find((e) => e.tag === 'new') ??
    entries.find((e) => e.version === version)!
  const selParts = parts.get(sel.version)!
  const empty = !selParts.intro && !selParts.added.length && !selParts.fixed.length
  // A patch release (x.y.1) says "everything from x.y.0": show that one below it.
  const [maj, min, pat] = sel.version.split('.')
  const base = pat && pat !== '0' ? entries.find((e) => e.version === `${maj}.${min}.0`) : undefined

  return (
    <section className="ab-wn" id="whats-new" aria-labelledby="ab-wn-h">
      <h2 id="ab-wn-h">What’s new</h2>
      <div className="ab-split">
        <nav className="ab-vl" aria-label="Versions">
          {entries.map((e) => (
            <button
              key={e.version}
              className={`ab-vr${e === sel ? ' on' : ''}`}
              aria-current={e === sel ? 'true' : undefined}
              onClick={() => setPicked(e.version)}
            >
              <span className="ab-v">
                {e.version}
                {e.tag ? <span className={`ab-tag ${e.tag}`}>{e.tag}</span> : null}
              </span>
              <span className="ab-t">
                {cap(e.title || parts.get(e.version)!.title || 'Release notes')}
              </span>
            </button>
          ))}
          <button
            className="ab-all"
            onClick={() => void api.shell.openExternal(releasePageUrl(sel.version))}
          >
            <IconExport small />
            Release notes on GitHub
          </button>
        </nav>
        <div className="ab-notes" key={sel.version}>
          {empty ? (
            <article className="ab-note" aria-label={`Release notes for ${sel.version}`}>
              <div className="ab-vh">
                <h3>{sel.version}</h3>
              </div>
              <p className="ab-vsub">No notes for this version.</p>
            </article>
          ) : (
            <VersionNotes e={sel} parts={selParts} />
          )}
          {base ? (
            <div className="ab-base">
              <VersionNotes e={base} parts={parts.get(base.version)!} small />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
