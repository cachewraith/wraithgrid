import { useActions, useApp } from '../app/services'
import { SHORTCUT_HINT } from '../app/shortcuts'

export function StatusBar() {
  const actions = useActions()
  const update = useApp((s) =>
    s.update.result?.status === 'available' ? s.update.result.latest.version : null
  )
  // Once, after an update restarted the app.
  const updatedTo = useApp((s) => s.update.updatedTo)

  return (
    <footer className="sbar">
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
