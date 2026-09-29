import type { Config } from '@shared/types'
import { useActions, useApp } from '../app/services'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { IconGrid4, IconPlus, IconSidebar, IconUserPlus } from './icons'

export function accountColorsFor(config: Config, wsId: string): string[] {
  const ws = config.workspaces.find((w) => w.id === wsId)
  if (!ws) return []
  const ids = [...new Set(ws.panes.map((p) => p.accountId).filter((x): x is string => !!x))]
  return ids.flatMap((id) => config.accounts.find((a) => a.id === id)?.color ?? [])
}

export function Sidebar() {
  const actions = useActions()
  const collapsed = useApp((s) => s.config.settings.sidebarCollapsed)
  const view = useApp((s) => s.view)
  const config = useApp((s) => s.config)
  const { workspaces, accounts, activeWorkspace: activeId } = config
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar'

  const newPane = (): void => actions.openModal({ kind: 'newPane', slotId: null })

  return (
    <aside className={`side${collapsed ? ' col' : ''}`} aria-label="Sidebar">
      <div className="side-hd">
        {collapsed ? null : <b>Workspaces</b>}
        <button
          className="icon-btn"
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={actions.toggleSidebar}
        >
          <IconSidebar />
        </button>
      </div>

      {collapsed ? (
        <>
          <div className="cdots" aria-label="Accounts">
            {accounts.map((a) => (
              <span
                key={a.id}
                className="dot"
                role="img"
                style={{ background: a.color }}
                title={`${a.name} — ${a.signedIn ? 'signed in' : 'login needed'}`}
                aria-label={`${a.name}, ${a.signedIn ? 'signed in' : 'login needed'}`}
              />
            ))}
          </div>
          <div className="side-ft">
            <button
              className="icon-btn"
              aria-label={`New pane (${SHORTCUT_HINT.newPane})`}
              title={`New pane (${SHORTCUT_HINT.newPane})`}
              onClick={newPane}
            >
              <IconPlus />
            </button>
            <button
              className="icon-btn"
              aria-label="Switch workspace"
              title={`Switch workspace (${SHORTCUT_HINT.workspace})`}
              onClick={() => actions.openModal({ kind: 'workspaces' })}
            >
              <IconGrid4 />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="sec">
            <div className="sec-hd">
              <span>{SHORTCUT_HINT.workspace}</span>
              <button onClick={() => actions.openModal({ kind: 'workspaces' })}>Manage</button>
            </div>
            {workspaces.map((w, i) => {
              const on = w.id === activeId && view === 'grid'
              const key = i < 9 ? i + 1 : null
              return (
                <button
                  key={w.id}
                  className={`ws-row${on ? ' on' : ''}`}
                  aria-current={on ? 'true' : undefined}
                  title={key ? `Switch to ${w.name} (Ctrl+Shift+${key})` : `Switch to ${w.name}`}
                  onClick={() => actions.switchWorkspace(w.id)}
                >
                  <span className="ws-name">{w.name}</span>
                  <span className="dots">
                    {accountColorsFor(config, w.id).map((c) => (
                      <span key={c} className="dot" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="cnt" aria-label={`${w.panes.length} panes`}>
                    {w.panes.length}
                  </span>
                  {key ? <kbd>{key}</kbd> : null}
                </button>
              )
            })}
          </div>
          <div className="sec">
            <div className="sec-hd">
              <span>Accounts</span>
              <button onClick={() => actions.setView('accounts')}>Manage</button>
            </div>
            {accounts.length === 0 ? <div className="side-empty">No accounts yet.</div> : null}
            {accounts.map((a) => (
              <div key={a.id} className="acc-row">
                <span className="dot" style={{ background: a.color }} />
                <span className="nm">{a.name}</span>
                <span className={`acc-sub${a.signedIn ? '' : ' warn'}`}>
                  {a.signedIn ? 'signed in' : 'login needed'}
                </span>
              </div>
            ))}
          </div>
          <div className="side-ft">
            <button
              className="btn pri full"
              onClick={newPane}
              title={`New pane (${SHORTCUT_HINT.newPane})`}
            >
              <IconPlus />
              New pane<kbd>{SHORTCUT_HINT.newPane}</kbd>
            </button>
            <button className="btn gh full" onClick={() => actions.setAccountsMode('add')}>
              <IconUserPlus />
              New account
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
