// The git diff of the focused pane's folder, beside the grid: what the agent changed since
// the last commit, file by file; it refreshes when the change count moves. Its footer commits
// everything, pushes the branch and opens the pull-request page, each only on a click, and
// push / pull request (they leave this machine) after a confirm.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { DIFF_WIDTH_DEFAULT, DIFF_WIDTH_MAX, DIFF_WIDTH_MIN } from '@shared/types'
import type { GitDiffResult } from '@shared/ipc-contract'
import { useActions, useApp, useServices } from '../app/services'
import { findPane } from '../app/store'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { parsePatch, type DiffFile } from '../lib/diff'
import { EdgeResizer } from './EdgeResizer'
import { IconBranch, IconChevron, IconClose, IconRestart } from './icons'

function FileDiff({ file }: { file: DiffFile }) {
  const [open, setOpen] = useState(true)
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

type GitAction = 'commit' | 'push' | 'pr'

const CONFIRM: Record<Exclude<GitAction, 'commit'>, (branch: string) => string> = {
  push: (b) => `Push ${b} to its remote?`,
  pr: (b) => `Open a pull request page for ${b} in your browser?`
}

/** Commit / push / pull request for the focused pane's repository. */
function GitActions({
  paneId,
  branch,
  changed,
  ahead
}: {
  paneId: string
  branch: string | null
  changed: number
  ahead: number
}) {
  const { api } = useServices()
  const actions = useActions()
  const [message, setMessage] = useState('')
  const [asking, setAsking] = useState<'push' | 'pr' | null>(null)
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
          <span>{CONFIRM[asking](branch)}</span>
          <button className="btn gh sm" onClick={() => setAsking(null)}>
            Cancel
          </button>
          <button className="btn pri sm" onClick={() => void run(asking)}>
            {asking === 'push' ? 'Push' : 'Open'}
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

export function DiffPanel() {
  const { api } = useServices()
  const actions = useActions()
  const paneId = useApp((s) => s.focusedPaneId)
  const pane = useApp((s) => (s.focusedPaneId ? findPane(s.config, s.focusedPaneId)?.pane : null))
  const git = useApp((s) => (s.focusedPaneId ? s.git[s.focusedPaneId] : undefined))
  const width = useApp((s) => s.config.settings.diffWidth)
  const panelRef = useRef<HTMLElement>(null)
  const [nonce, setNonce] = useState(0)
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
        <span className="dp-title">Changes</span>
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
        {files.length ? (
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
      <div className="dp-bd">{body}</div>
      {pane && paneId && git?.repo ? (
        <GitActions paneId={paneId} branch={git.branch} changed={git.changed} ahead={git.ahead} />
      ) : null}
    </aside>
  )
}
