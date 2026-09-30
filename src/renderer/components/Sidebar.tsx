import type { Config } from '@shared/types'
import { useActions, useApp } from '../app/services'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { AccountIcon, Avatar } from './AccountIcon'
import { IconGrid4, IconPlus, IconSidebar, IconUserPlus } from './icons'
import { SidebarAccounts } from './SidebarAccounts'

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
        {collapsed ? null : <span />}
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
                role="img"
                title={`${a.name} — ${a.signedIn ? 'signed in' : 'login needed'}`}
                aria-label={`${a.name}, ${a.signedIn ? 'signed in' : 'login needed'}`}
                style={{ display: 'inline-flex' }}
              >
                <AccountIcon account={a} size={20} />
              </span>
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
              <span>Workspaces</span>
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
                  <Avatar icon={w.icon} name={w.name} color="var(--acc)" />
                  <span className="ws-name">{w.name}</span>
                  <span className="dots">
                    {accountColorsFor(config, w.id).map((c) => (
                      <span key={c} className="dot" style={{ background: c }} />
                    ))}
                  </span>
                  <span
                    className="cnt"
                    aria-label={`${w.panes.length} panes`}
                    title={`${w.panes.length} ${w.panes.length === 1 ? 'pane' : 'panes'}`}
                  >
                    {w.panes.length}
                  </span>
                  {key ? <kbd className="ws-key">{key}</kbd> : null}
                </button>
              )
            })}
          </div>
          <SidebarAccounts />
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
