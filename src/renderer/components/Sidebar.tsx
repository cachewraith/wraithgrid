import { useEffect, useRef, useState } from 'react'
import { PANE_STATUS_LABEL, type Config, type Pane, type Workspace } from '@shared/types'
import { useActions, useApp } from '../app/services'
import { accountById } from '../app/store'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { AccountIcon, Avatar } from './AccountIcon'
import { ContextMenu, menuPoint, type MenuPoint } from './ContextMenu'
import { IconPopover } from './IconPicker'
import {
  IconChevron,
  IconCompose,
  IconGrid4,
  IconRename,
  IconSearch,
  IconSidebar,
  IconSun,
  IconTrash,
  IconUserPlus
} from './icons'
import { SidebarAccounts } from './SidebarAccounts'

export function accountColorsFor(config: Config, wsId: string): string[] {
  const ws = config.workspaces.find((w) => w.id === wsId)
  if (!ws) return []
  const ids = [...new Set(ws.panes.map((p) => p.accountId).filter((x): x is string => !!x))]
  return ids.flatMap((id) => config.accounts.find((a) => a.id === id)?.color ?? [])
}

/** How long the collapse/expand transition runs (matches `.side` in base.css), plus slack. */
const SIDE_MOVE_MS = 260

/** A pane under its workspace, like a chat in a chat app's history: click to jump to it. */
function PaneRow({ pane }: { pane: Pane }) {
  const actions = useActions()
  const account = useApp((s) => accountById(s.config, pane.accountId))
  const status = useApp((s) => s.runtime[pane.id]?.status ?? null)
  const on = useApp((s) => s.focusedPaneId === pane.id && s.view === 'grid')
  const branch = useApp((s) => s.git[pane.id]?.branch ?? null)
  const loud = status === 'approval' || status === 'login' || status === 'exited'
  return (
    <button
      className={`pn-row${on ? ' on' : ''}`}
      aria-current={on ? 'true' : undefined}
      title={`${pane.title}${account ? ` · ${account.name}` : ' · shell'}${branch ? ` · ${branch}` : ''}`}
      onClick={() => actions.revealPane(pane.id)}
    >
      <span className={`pn-dot st-${status ?? 'idle'}`} aria-hidden="true" />
      <span className="pn-name">{pane.title}</span>
      {status && loud ? (
        <span className={`pn-st st-${status}`}>{PANE_STATUS_LABEL[status]}</span>
      ) : (
        <span className="pn-acc">{account?.name ?? 'shell'}</span>
      )}
    </button>
  )
}

/** One workspace in the sidebar: click to switch, right-click to rename, re-icon or delete. */
function WorkspaceRow({
  w,
  index,
  expanded,
  onToggle
}: {
  w: Workspace
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  const actions = useActions()
  const config = useApp((s) => s.config)
  const on = useApp((s) => s.config.activeWorkspace === w.id && s.view === 'grid')
  const [menu, setMenu] = useState<MenuPoint | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [iconAt, setIconAt] = useState<{ top: number; left: number } | null>(null)
  const rowRef = useRef<HTMLButtonElement>(null)
  const key = index < 9 ? index + 1 : null
  const canDelete = config.workspaces.length > 1
  const panes = w.panes.length

  const saveRename = (): void => {
    if (renaming?.trim()) actions.renameWorkspace(w.id, renaming)
    setRenaming(null)
  }

  if (renaming !== null) {
    return (
      <div className="ws-row on">
        <Avatar icon={w.icon} name={w.name} color="var(--fa)" />
        <input
          className="inpt sans ws-in"
          value={renaming}
          maxLength={64}
          aria-label="Workspace name"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={saveRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveRename()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setRenaming(null)
            }
          }}
        />
      </div>
    )
  }

  return (
    <>
      <div className="ws-wrap">
        <button
          className="ws-tg"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} panes of ${w.name}`}
          disabled={panes === 0}
          onClick={onToggle}
        >
          <IconChevron small className={`chev-i${expanded ? ' open' : ''}`} />
        </button>
        <button
          ref={rowRef}
          className={`ws-row${on ? ' on' : ''}${menu ? ' menu' : ''}`}
          aria-current={on ? 'true' : undefined}
          title={key ? `Switch to ${w.name} (Ctrl+Shift+${key})` : `Switch to ${w.name}`}
          onClick={() => actions.switchWorkspace(w.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            setConfirmDelete(false)
            setMenu(menuPoint(e))
          }}
        >
          <Avatar icon={w.icon} name={w.name} color="var(--fa)" />
          <span className="ws-name">{w.name}</span>
          <span className="dots">
            {accountColorsFor(config, w.id).map((c) => (
              <span key={c} className="dot" style={{ background: c }} />
            ))}
          </span>
          <span
            className="cnt"
            aria-label={`${panes} panes`}
            title={`${panes} ${panes === 1 ? 'pane' : 'panes'}`}
          >
            {panes}
          </span>
          {key ? <kbd className="ws-key">{key}</kbd> : null}
        </button>
      </div>
      {expanded && panes ? (
        <div className="pn-list">
          {w.panes.map((p) => (
            <PaneRow key={p.id} pane={p} />
          ))}
        </div>
      ) : null}
      {menu ? (
        <ContextMenu
          at={menu}
          label={`Workspace ${w.name}`}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename', icon: <IconRename small />, onSelect: () => setRenaming(w.name) },
            {
              label: 'Change icon',
              icon: <IconSun small />,
              // The icon grid opens under the row.
              onSelect: () => {
                const r = rowRef.current?.getBoundingClientRect()
                if (r) setIconAt({ top: r.bottom + 6, left: r.left + 8 })
              }
            },
            {
              label: !canDelete
                ? 'Delete (last workspace)'
                : confirmDelete
                  ? panes
                    ? `Click again: closes ${panes} ${panes === 1 ? 'pane' : 'panes'}`
                    : 'Click again to delete'
                  : 'Delete workspace',
              icon: <IconTrash small />,
              danger: true,
              disabled: !canDelete,
              onSelect: () => {
                if (!confirmDelete) {
                  setConfirmDelete(true)
                  return false
                }
                actions.deleteWorkspace(w.id)
              }
            }
          ]}
        />
      ) : null}
      {iconAt ? (
        <IconPopover
          at={iconAt}
          icon={w.icon}
          name={w.name}
          onPick={(icon) => {
            actions.setWorkspaceIcon(w.id, icon)
            setIconAt(null)
          }}
          onClose={() => setIconAt(null)}
        />
      ) : null}
    </>
  )
}

export function Sidebar() {
  const actions = useActions()
  const collapsed = useApp((s) => s.config.settings.sidebarCollapsed)
  const config = useApp((s) => s.config)
  const { workspaces, accounts } = config
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  // While the width animates, the content keeps a fixed width (`.moving`) so it is revealed
  // or clipped instead of reflowing. Only then: at rest it must fit beside a scrollbar.
  const [shown, setShown] = useState(collapsed)
  const [moving, setMoving] = useState(false)
  if (shown !== collapsed) {
    setShown(collapsed)
    setMoving(true)
  }
  useEffect(() => {
    if (!moving) return
    const t = setTimeout(() => setMoving(false), SIDE_MOVE_MS)
    return () => clearTimeout(t)
  }, [moving, collapsed])

  const newPane = (): void => actions.openModal({ kind: 'newPane', slotId: null })
  const search = (): void => actions.openModal({ kind: 'palette' })
  // Which workspaces show their panes: the active one opens by default; UI state only.
  const activeId = config.activeWorkspace
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const isExpanded = (id: string): boolean => toggled[id] ?? id === activeId

  return (
    <aside
      className={`side${collapsed ? ' col' : ''}${moving ? ' moving' : ''}`}
      aria-label="Sidebar"
    >
      <div className="side-hd">
        <button
          className="icon-btn"
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={actions.toggleSidebar}
        >
          <IconSidebar />
        </button>
        {collapsed ? null : (
          <button
            className="icon-btn"
            aria-label={`New pane (${SHORTCUT_HINT.newPane})`}
            title={`New pane (${SHORTCUT_HINT.newPane})`}
            onClick={newPane}
          >
            <IconCompose />
          </button>
        )}
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
              <IconCompose />
            </button>
            <button
              className="icon-btn"
              aria-label={`Search (${SHORTCUT_HINT.palette})`}
              title={`Search (${SHORTCUT_HINT.palette})`}
              onClick={search}
            >
              <IconSearch />
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
          <nav className="side-nav" aria-label="Quick actions">
            <button
              className="nav-row"
              onClick={newPane}
              title={`New pane (${SHORTCUT_HINT.newPane})`}
            >
              <IconCompose />
              <span>New pane</span>
              <kbd>{SHORTCUT_HINT.newPane}</kbd>
            </button>
            <button
              className="nav-row"
              onClick={search}
              title={`Search (${SHORTCUT_HINT.palette})`}
            >
              <IconSearch />
              <span>Search</span>
              <kbd>{SHORTCUT_HINT.palette}</kbd>
            </button>
          </nav>
          <div className="sec">
            <div className="sec-hd">
              <span>Workspaces</span>
              <button onClick={() => actions.openModal({ kind: 'workspaces' })}>Manage</button>
            </div>
            {workspaces.map((w, i) => (
              <WorkspaceRow
                key={w.id}
                w={w}
                index={i}
                expanded={isExpanded(w.id)}
                onToggle={() => setToggled((t) => ({ ...t, [w.id]: !isExpanded(w.id) }))}
              />
            ))}
          </div>
          <SidebarAccounts />
          <div className="side-ft">
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
