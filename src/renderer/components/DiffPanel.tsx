// The git diff of the focused pane's folder, beside the grid: what the agent changed since
// the last commit, file by file; it refreshes when the change count moves. History shows the
// commits as a graph (a page at a time) and opens any commit's diff. Its footer commits
// everything, pulls, pushes and opens the pull-request page, each only on a click; push /
// pull request (they leave this machine) and a pull over uncommitted changes after a confirm.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { DIFF_WIDTH_DEFAULT, DIFF_WIDTH_MAX, DIFF_WIDTH_MIN } from '@shared/types'
import type { GitCommit, GitDiffResult, GitShowResult } from '@shared/ipc-contract'
import { useActions, useApp, useServices } from '../app/services'
import { findPane } from '../app/store'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { parsePatch, type DiffFile } from '../lib/diff'
import { layoutGraph, refLabels, type GraphRow } from '../lib/commit-graph'
import { ago } from '../lib/time'
import { EdgeResizer } from './EdgeResizer'
import { IconBranch, IconChevron, IconClose, IconRestart } from './icons'

function FileDiff({ file, initiallyOpen = true }: { file: DiffFile; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const name = file.path.split('/').pop() ?? file.path
  const dir = file.path.slice(0, file.path.length - name.length)
  return (
    <div className="df">
      <button className="df-hd" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <IconChevron small className={`df-chev${open ? ' open' : ''}`} />
        <span
          className="df-name"
          title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        >
          {dir ? <span className="df-dir">{dir}</span> : null}
          {name}
        </span>
        {file.status !== 'modified' ? <span className="df-tag">{file.status}</span> : null}
        <span className="df-n">
          <span className="add">+{file.added}</span> <span className="del">−{file.removed}</span>
        </span>
      </button>
      {open ? (
        file.binary ? (
          <div className="df-note">Binary file</div>
        ) : (
          <pre className="df-body">
            {file.lines.map((l, i) => (
              <div key={i} className={`dl dl-${l.kind}`}>
                {l.kind === 'hunk' || l.kind === 'meta'
                  ? l.text
                  : `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`}
              </div>
            ))}
          </pre>
        )
      ) : null}
    </div>
  )
}

type GitAction = 'commit' | 'push' | 'pull' | 'pr'
type Asked = Exclude<GitAction, 'commit'>

const CONFIRM: Record<Asked, (branch: string, changed: number) => string> = {
  push: (b) => `Push ${b} to its remote?`,
  pull: (b, n) =>
    `${n} uncommitted ${n === 1 ? 'change' : 'changes'} in this folder. Pull ${b} anyway? git stops if they are in the way.`,
  pr: (b) => `Open a pull request page for ${b} in your browser?`
}
const CONFIRM_BUTTON: Record<Asked, string> = { push: 'Push', pull: 'Pull', pr: 'Open' }

/** Commit / pull / push / pull request for the focused pane's repository. */
function GitActions({
  paneId,
  branch,
  changed,
  ahead,
  behind
}: {
  paneId: string
  branch: string | null
  changed: number
  ahead: number
  behind: number
}) {
  const { api } = useServices()
  const actions = useActions()
  const [message, setMessage] = useState('')
  const [asking, setAsking] = useState<Asked | null>(null)
  const [busy, setBusy] = useState<GitAction | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async (what: GitAction): Promise<void> => {
    setAsking(null)
    setBusy(what)
    setResult(null)
    const r =
      what === 'commit'
        ? await api.git.commit(paneId, message)
        : what === 'push'
          ? await api.git.push(paneId)
          : what === 'pull'
            ? await api.git.pull(paneId)
            : await api.git.openPullRequest(paneId)
    setBusy(null)
    setResult(r.ok ? { ok: true, text: r.detail } : { ok: false, text: r.error })
    if (r.ok && what === 'commit') setMessage('')
    void actions.refreshGit()
  }

  return (
    <div className="dp-ft">
      <textarea
        className="inpt dp-msg"
        placeholder={changed ? 'Commit message' : 'Nothing to commit'}
        aria-label="Commit message"
        value={message}
        disabled={!changed || !!busy}
        rows={2}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && message.trim()) {
            e.preventDefault()
            void run('commit')
          }
        }}
      />
      {asking && branch ? (
        <div className="dp-ask" role="alert">
          <span>{CONFIRM[asking](branch, changed)}</span>
          <button className="btn gh sm" onClick={() => setAsking(null)}>
            Cancel
          </button>
          <button className="btn pri sm" onClick={() => void run(asking)}>
            {CONFIRM_BUTTON[asking]}
          </button>
        </div>
      ) : (
        <div className="dp-acts">
          <button
            className="btn pri sm"
            disabled={!changed || !message.trim() || !!busy}
            onClick={() => void run('commit')}
            title="Stage every change and commit (Ctrl+Enter)"
          >
            {busy === 'commit' ? 'Committing…' : `Commit all${changed ? ` (${changed})` : ''}`}
          </button>
          <button
            className="btn sm"
            disabled={!branch || !!busy}
            onClick={() => (changed ? setAsking('pull') : void run('pull'))}
            title={behind ? `${behind} commits to pull (as of the last fetch)` : 'Fetch and pull'}
          >
            {busy === 'pull' ? 'Pulling…' : `Pull${behind ? ` (${behind})` : ''}`}
          </button>
          <button
            className="btn sm"
            disabled={!branch || !!busy}
            onClick={() => setAsking('push')}
            title={ahead ? `${ahead} commits not pushed` : 'Push the branch'}
          >
            {busy === 'push' ? 'Pushing…' : `Push${ahead ? ` (${ahead})` : ''}`}
          </button>
          <button className="btn sm" disabled={!branch || !!busy} onClick={() => setAsking('pr')}>
            Pull request
          </button>
        </div>
      )}
      {result ? (
        <div className={`hint${result.ok ? '' : ' err'}`} role="status">
          {result.text}
        </div>
      ) : null}
    </div>
  )
}

const LANE = 14
const ROW = 46
const MID = ROW / 2
const LANE_COLORS = [
  'var(--acc)',
  'var(--ok)',
  'var(--warn)',
  'var(--acct)',
  'var(--mu)',
  'var(--fa)'
]
const laneX = (i: number): number => i * LANE + LANE / 2
const laneColor = (i: number): string => LANE_COLORS[i % LANE_COLORS.length]!

/** One line of the graph inside a row half: straight down, or a curve to another lane. */
function edgePath(from: number, to: number, y1: number, y2: number): string {
  const x1 = laneX(from)
  const x2 = laneX(to)
  if (x1 === x2) return `M${x1} ${y1}V${y2}`
  const ym = (y1 + y2) / 2
  return `M${x1} ${y1}C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`
}

function GraphCell({ row, width, merge }: { row: GraphRow; width: number; merge: boolean }) {
  return (
    <svg className="gh-g" width={width * LANE} height={ROW} aria-hidden="true">
      {row.top.map((e, i) => (
        <path key={`t${i}`} d={edgePath(e.from, e.to, 0, MID)} stroke={laneColor(e.color)} />
      ))}
      {row.bottom.map((e, i) => (
        <path key={`b${i}`} d={edgePath(e.from, e.to, MID, ROW)} stroke={laneColor(e.color)} />
      ))}
      <circle
        cx={laneX(row.col)}
        cy={MID}
        r={merge ? 3.5 : 4.5}
        fill={merge ? 'var(--bg)' : laneColor(row.color)}
        stroke={laneColor(row.color)}
        strokeWidth={2}
      />
    </svg>
  )
}

/** Straight lanes beside an opened commit's files, so the graph reads through it. */
function GraphThrough({ row, width }: { row: GraphRow; width: number }) {
  const lanes = [...new Set(row.bottom.map((e) => e.to))]
  return (
    <svg
      className="gh-through"
      width={width * LANE}
      viewBox={`0 0 ${width * LANE} 1`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {lanes.map((l) => {
        const e = row.bottom.find((x) => x.to === l)!
        return (
          <path
            key={l}
            d={`M${laneX(l)} 0V1`}
            stroke={laneColor(e.color)}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}

function CommitFiles({ paneId, sha }: { paneId: string; sha: string }) {
  const { api } = useServices()
  const [r, setR] = useState<GitShowResult | null>(null)
  useEffect(() => {
    let live = true
    void api.git.show(paneId, sha).then((x) => live && setR(x))
    return () => {
      live = false
    }
  }, [api, paneId, sha])
  const files = useMemo(() => (r?.ok ? parsePatch(r.patch) : []), [r])
  if (!r) return <div className="dp-empty">Loading…</div>
  if (!r.ok) return <div className="dp-empty">{r.error}</div>
  if (!files.length) return <div className="dp-empty">No file changes in this commit.</div>
  return (
    <div className="gh-files">
      {files.map((f) => (
        <FileDiff key={f.path} file={f} initiallyOpen={files.length === 1} />
      ))}
      {r.truncated ? (
        <div className="dp-empty">Too large; only the first part is shown.</div>
      ) : null}
    </div>
  )
}

/** The commit graph: every branch and tag, newest first, a page at a time. */
function History({ paneId, reload }: { paneId: string; reload: string }) {
  const { api } = useServices()
  const [commits, setCommits] = useState<GitCommit[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  // "3h ago" is relative to when the page loaded.
  const [now, setNow] = useState(0)

  useEffect(() => {
    let live = true
    void api.git.log(paneId, 0).then((r) => {
      if (!live) return
      if (r.ok) {
        setCommits(r.commits)
        setMore(r.more)
        setError(null)
        setNow(Date.now())
      } else setError(r.error)
    })
    return () => {
      live = false
    }
  }, [api, paneId, reload])

  const rows = useMemo(() => layoutGraph(commits ?? []), [commits])
  const width = rows.reduce((w, r) => Math.max(w, r.width), 1)

  const loadMore = async (): Promise<void> => {
    if (!commits) return
    setLoadingMore(true)
    const r = await api.git.log(paneId, commits.length)
    setLoadingMore(false)
    if (r.ok) {
      setCommits([...commits, ...r.commits])
      setMore(r.more)
    } else setError(r.error)
  }

  if (error) return <div className="dp-empty">{error}</div>
  if (!commits) return <div className="dp-empty">Loading…</div>
  if (!commits.length) return <div className="dp-empty">No commits yet.</div>
  return (
    <ol className="gh" aria-label="Commit history">
      {commits.map((c, i) => {
        const row = rows[i]!
        const on = open === c.sha
        return (
          <li key={c.sha} className={`gh-row${on ? ' on' : ''}`}>
            <div className="gh-line">
              <GraphCell row={row} width={width} merge={c.parents.length > 1} />
              <button
                className="gh-main"
                aria-expanded={on}
                title={`${c.sha.slice(0, 10)} · ${new Date(c.time).toLocaleString()}`}
                onClick={() => setOpen(on ? null : c.sha)}
              >
                <span className="gh-subj">
                  {refLabels(c.refs).map((r) => (
                    <span key={r.text} className={`gh-ref ${r.kind}`}>
                      {r.text}
                    </span>
                  ))}
                  <span className="gh-text">{c.subject}</span>
                </span>
                <span className="gh-meta">
                  <span className="mono">{c.sha.slice(0, 7)}</span> · {c.author} ·{' '}
                  {ago(c.time, now)}
                </span>
              </button>
            </div>
            {on ? (
              <div className="gh-open">
                <GraphThrough row={row} width={width} />
                <CommitFiles paneId={paneId} sha={c.sha} />
              </div>
            ) : null}
          </li>
        )
      })}
      {more ? (
        <li className="gh-more">
          <button className="btn sm" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </li>
      ) : null}
    </ol>
  )
}

export function DiffPanel() {
  const { api } = useServices()
  const actions = useActions()
  const paneId = useApp((s) => s.focusedPaneId)
  const pane = useApp((s) => (s.focusedPaneId ? findPane(s.config, s.focusedPaneId)?.pane : null))
  const git = useApp((s) => (s.focusedPaneId ? s.git[s.focusedPaneId] : undefined))
  const width = useApp((s) => s.config.settings.diffWidth)
  const panelRef = useRef<HTMLElement>(null)
  const [nonce, setNonce] = useState(0)
  const [tab, setTab] = useState<'changes' | 'history'>('changes')
  // Each fetch is stamped with what it was for; a stale stamp means a newer one is loading.
  const stamp = `${paneId}:${nonce}:${git?.changed}:${git?.branch}`
  const [loaded, setLoaded] = useState<{ stamp: string; result: GitDiffResult } | null>(null)
  const loading = loaded?.stamp !== stamp

  // Refetch when the pane changes, git reports a different set of changes, or on Refresh.
  useEffect(() => {
    if (!paneId) return
    let live = true
    void api.git.diff(paneId).then((result) => {
      if (live) setLoaded({ stamp, result })
    })
    return () => {
      live = false
    }
  }, [api, paneId, stamp])
  const result = loaded?.result ?? null

  const files = useMemo(() => (result?.ok ? parsePatch(result.patch) : []), [result])
  const added = files.reduce((n, f) => n + f.added, 0)
  const removed = files.reduce((n, f) => n + f.removed, 0)
  const untracked = result?.ok ? result.untracked : []

  let body: React.ReactNode
  if (!pane) body = <div className="dp-empty">Focus a pane to see its changes.</div>
  else if (git && !git.repo)
    body = <div className="dp-empty">{pane.title} is not in a git repository.</div>
  else if (!result) body = <div className="dp-empty">Loading…</div>
  else if (!result.ok) body = <div className="dp-empty">{result.error}</div>
  else if (files.length === 0 && untracked.length === 0)
    body = <div className="dp-empty">No changes since the last commit.</div>
  else
    body = (
      <>
        {files.map((f) => (
          <FileDiff key={f.path} file={f} />
        ))}
        {untracked.length ? (
          <div className="df">
            <div className="df-hd static">
              <span className="df-name">Untracked</span>
              <span className="df-n">{untracked.length}</span>
            </div>
            <ul className="df-list">
              {untracked.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {result.truncated ? (
          <div className="dp-empty">The diff is too large; only the first part is shown.</div>
        ) : null}
      </>
    )

  return (
    <aside
      className="dp"
      aria-label="Changes"
      ref={panelRef}
      style={{ '--dp-width': `${width}px` } as CSSProperties}
    >
      <EdgeResizer
        target={panelRef}
        cssVar="--dp-w"
        edge="left"
        min={DIFF_WIDTH_MIN}
        max={DIFF_WIDTH_MAX}
        label="Resize changes panel"
        className="dp-resize"
        onCommit={(w) => actions.updateSettings({ diffWidth: w })}
        onReset={() => actions.updateSettings({ diffWidth: DIFF_WIDTH_DEFAULT })}
      />
      <div className="dp-hd">
        <div className="seg dp-tabs" role="tablist" aria-label="Changes panel">
          {(['changes', 'history'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`seg-btn${tab === t ? ' on' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'changes' ? 'Changes' : 'History'}
            </button>
          ))}
        </div>
        {git?.branch ? (
          <button
            className="dp-branch"
            title={`${git.branch}: switch branch`}
            aria-label={`Branch ${git.branch}. Switch branch`}
            disabled={!paneId}
            onClick={(e) => {
              if (!paneId) return
              const r = e.currentTarget.getBoundingClientRect()
              actions.openModal({ kind: 'branches', paneId, at: { x: r.left, y: r.bottom + 4 } })
            }}
          >
            <IconBranch small />
            {git.branch}
          </button>
        ) : null}
        {files.length && tab === 'changes' ? (
          <span className="df-n">
            <span className="add">+{added}</span> <span className="del">−{removed}</span>
          </span>
        ) : null}
        <span className="top-sp" />
        <button
          className="icon-btn sm"
          aria-label="Refresh"
          title="Refresh"
          disabled={loading || !pane}
          onClick={() => setNonce((n) => n + 1)}
        >
          <IconRestart small />
        </button>
        <button
          className="icon-btn sm"
          aria-label={`Close changes (${SHORTCUT_HINT.diff})`}
          title={`Close (${SHORTCUT_HINT.diff})`}
          onClick={() => actions.toggleDiff(false)}
        >
          <IconClose small />
        </button>
      </div>
      {pane ? <div className="dp-sub mono">{pane.cwd}</div> : null}
      <div className="dp-bd" role="tabpanel">
        {tab === 'history' && pane && paneId && git?.repo !== false ? (
          <History
            paneId={paneId}
            reload={`${nonce}:${git?.branch}:${git?.ahead}:${git?.behind}`}
          />
        ) : (
          body
        )}
      </div>
      {pane && paneId && git?.repo ? (
        <GitActions
          paneId={paneId}
          branch={git.branch}
          changed={git.changed}
          ahead={git.ahead}
          behind={git.behind}
        />
      ) : null}
    </aside>
  )
}
