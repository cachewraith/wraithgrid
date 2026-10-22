import { useActions, useApp } from '../app/services'
import { activeWorkspace } from '../app/store'
import { SHORTCUT_HINT } from '../app/shortcuts'

export function StatusBar() {
  const actions = useActions()
  const ws = useApp(activeWorkspace)
  const accountCount = new Set(ws.panes.flatMap((p) => (p.accountId ? [p.accountId] : []))).size
  const update = useApp((s) =>
    s.update.result?.status === 'available' ? s.update.result.latest.version : null
  )
  // Once, after an update restarted the app.
  const updatedTo = useApp((s) => s.update.updatedTo)

  return (
    <footer className="sbar">
      <span>
        <b>{ws.panes.length}</b> {ws.panes.length === 1 ? 'pane' : 'panes'}
        {accountCount > 0 ? (
          <>
            {' '}
            on <b>{accountCount}</b> {accountCount === 1 ? 'account' : 'accounts'}
          </>
        ) : null}
      </span>
      <span className="sp" />
      {updatedTo ? (
        <span className="upd-done">
          <button
            className="upd"
            onClick={() => {
              actions.showUpdates()
              actions.dismissUpdated()
            }}
          >
            Updated to {updatedTo} · See what’s new
          </button>
          <button
            className="upd-x"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={actions.dismissUpdated}
          >
            ×
          </button>
        </span>
      ) : null}
      {update ? (
        <button className="upd" onClick={actions.showUpdates}>
          Update available: {update}
        </button>
      ) : null}
      <span className="sbar-hint">{SHORTCUT_HINT.focus} focus</span>
      <button className="sbar-hint" onClick={() => actions.openModal({ kind: 'shortcuts' })}>
        <kbd>{SHORTCUT_HINT.shortcuts}</kbd>All shortcuts
      </button>
    </footer>
  )
}
