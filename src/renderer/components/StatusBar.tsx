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

  return (
    <footer className="sbar">
      <span>
        <b>{ws.panes.length}</b> {ws.panes.length === 1 ? 'pane' : 'panes'}
      </span>
      <span>
        <b>{accountCount}</b> {accountCount === 1 ? 'account' : 'accounts'}
      </span>
      <span>
        workspace <b>{ws.name}</b>
      </span>
      <span className="sp" />
      {update ? (
        <button className="upd" onClick={actions.showUpdates}>
          Update available: {update}
        </button>
      ) : null}
      <span>{SHORTCUT_HINT.focus} focus</span>
      <button onClick={() => actions.openModal({ kind: 'shortcuts' })}>
        <kbd>{SHORTCUT_HINT.shortcuts}</kbd>All shortcuts
      </button>
    </footer>
  )
}
