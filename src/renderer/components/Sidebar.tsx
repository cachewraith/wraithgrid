import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent
} from 'react'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type Config,
  type Workspace
} from '@shared/types'
import { useActions, useApp } from '../app/services'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { Initial } from './AccountIcon'
import { ContextMenu, menuPoint, type MenuPoint } from './ContextMenu'
import { EdgeResizer } from './EdgeResizer'
import {
  IconChevron,
  IconCompose,
  IconMods,
  IconMonitor,
  IconPlus,
  IconRename,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconTrash,
  IconUserPlus
} from './icons'

export function accountColorsFor(config: Config, wsId: string): string[] {
  const ws = config.workspaces.find((w) => w.id === wsId)
  if (!ws) return []
  const ids = [...new Set(ws.panes.map((p) => p.accountId).filter((x): x is string => !!x))]
  return ids.flatMap((id) => config.accounts.find((a) => a.id === id)?.color ?? [])
}

/** How long the collapse/expand transition runs (matches `.side` in base.css), plus slack. */
const SIDE_MOVE_MS = 260

/** One project (workspace): click to switch, right-click to rename, re-icon or delete. */
function WorkspaceRow({ w, index }: { w: Workspace; index: number }) {
  const actions = useActions()
  const config = useApp((s) => s.config)
  const on = useApp(
    (s) => s.config.activeWorkspace === w.id && (s.view === 'grid' || s.view === 'project')
  )
  const running = useApp((s) => w.panes.some((p) => s.runtime[p.id]?.status === 'running'))
  const waiting = useApp((s) =>
    w.panes.some((p) => {
      const st = s.runtime[p.id]?.status
      return st === 'approval' || st === 'login'
    })
  )
  const [menu, setMenu] = useState<MenuPoint | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const key = index < 9 ? index + 1 : null
  const canDelete = config.workspaces.length > 1
  const panes = w.panes.length
  const machine = config.machines.find((m) => m.id === w.machineId)
  // Where the panes run can change only while there are none: running ones stay where they are.
  const runOn = [
    { id: null, name: 'this computer' },
    ...config.machines.map((m) => ({ id: m.id, name: m.name }))
  ]
    .filter((t) => t.id !== (w.machineId ?? null))
    .map((t) => ({
      label: panes ? `Run on ${t.name} (close its panes first)` : `Run on ${t.name}`,
      icon: <IconMonitor small />,
      disabled: panes > 0,
      onSelect: () => actions.setWorkspaceMachine(w.id, t.id)
    }))

  const saveRename = (): void => {
    if (renaming?.trim()) actions.renameWorkspace(w.id, renaming)
    setRenaming(null)
  }
  const newChat = (): void => {
    actions.switchWorkspace(w.id)
    actions.openModal({ kind: 'newPane', slotId: null })
  }

  if (renaming !== null) {
    return (
      <div className="ws-row on">
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
    <div className="proj">
      <div className={`ws-wrap${menu ? ' menu' : ''}`}>
        <button
          className={`ws-row${on ? ' on' : ''}${menu ? ' menu' : ''}`}
          aria-current={on ? 'true' : undefined}
          title={key ? `Open ${w.name} (${SHORTCUT_HINT.workspaceN(key)})` : `Open ${w.name}`}
          onClick={() => actions.openProject(w.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            setConfirmDelete(false)
            setMenu(menuPoint(e))
          }}
        >
          <span className="ws-name">{w.name}</span>
          {machine ? (
            <span className="ws-mach" title={`Runs on ${machine.name} (${machine.sshHost})`}>
              {machine.name}
            </span>
          ) : null}
          {waiting ? (
            <span className="ws-wait" title="A chat needs you" />
          ) : running ? (
            <span className="pn-spin" title="A chat is working" />
          ) : null}
          {panes ? (
            <span
              className="cnt"
              aria-label={`${panes} open`}
              title={`${panes} open ${panes === 1 ? 'chat' : 'chats'}`}
            >
              {panes}
            </span>
          ) : null}
        </button>
        <button
          className="ws-add"
          aria-label={`New chat in ${w.name}`}
          title={`New chat in ${w.name}`}
          onClick={newChat}
        >
          <IconPlus small />
        </button>
      </div>
      {menu ? (
        <ContextMenu
          at={menu}
          label={`Workspace ${w.name}`}
          onClose={() => setMenu(null)}
          items={[
            { label: 'New chat', icon: <IconCompose small />, onSelect: newChat },
            { label: 'Rename', icon: <IconRename small />, onSelect: () => setRenaming(w.name) },
            ...(config.machines.length ? runOn : []),
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
    </div>
  )
}

/** The footer: who new chats run as, ChatGPT-style; the menu switches it and leads to accounts. */
function AccountSwitcher({ compact }: { compact: boolean }) {
  const actions = useActions()
  const accounts = useApp((s) => s.config.accounts)
  const defaultId = useApp((s) => s.config.settings.defaultAccountId)
  const [menu, setMenu] = useState<MenuPoint | null>(null)
  const current = accounts.find((a) => a.id === defaultId) ?? accounts[0]
  const plan = useApp((s) => (current ? s.accountInfo[current.id]?.info?.plan : null) ?? null)
  const open = (e: MouseEvent<HTMLButtonElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    // Opens upwards: the menu is pulled back inside the window from below.
    setMenu({ x: r.left, y: r.top - 8 - (accounts.length + 4) * 32 })
  }
  const label = current ? current.name : 'No account'
  return (
    <>
      <button
        className={`acct-sw${compact ? ' compact' : ''}${menu ? ' open' : ''}`}
        aria-label={`Account: ${label}. Switch account`}
        aria-haspopup="menu"
        title={compact ? label : undefined}
        onClick={open}
      >
        {current ? (
          <Initial name={current.name} size={compact ? 26 : 28} />
        ) : (
          <span className="acct-none">
            <IconUserPlus small />
          </span>
        )}
        {compact ? null : (
          <>
            <span className="acct-txt">
              <span className="acct-nm">{label}</span>
              <span className="acct-sub">
                {accounts.length === 0
                  ? 'Add one to start'
                  : current && !current.signedIn
                    ? 'Login needed'
                    : (plan ?? `${accounts.length} account${accounts.length === 1 ? '' : 's'}`)}
              </span>
            </span>
            <IconChevron small className="acct-chev" />
          </>
        )}
      </button>
      {menu ? (
        <ContextMenu
          at={menu}
          label="Accounts"
          onClose={() => setMenu(null)}
          items={[
            ...accounts.map((a) => ({
              label: `${a.name}${a.id === current?.id ? '  ✓' : ''}${a.signedIn ? '' : ' · login needed'}`,
              icon: <Initial name={a.name} size={16} />,
              onSelect: () => actions.updateSettings({ defaultAccountId: a.id })
            })),
            {
              label: 'New account',
              icon: <IconUserPlus small />,
              onSelect: () => actions.setAccountsMode('add')
            },
            {
              label: 'Manage accounts',
              icon: <IconRename small />,
              onSelect: () => actions.setView('accounts')
            },
            { label: 'Mods', icon: <IconMods small />, onSelect: () => actions.setView('mods') },
            {
              label: 'Settings',
              icon: <IconSettings small />,
              onSelect: () => actions.setView('settings')
            }
          ]}
        />
      ) : null}
    </>
  )
}

export function Sidebar() {
  const actions = useActions()
  const collapsed = useApp((s) => s.config.settings.sidebarCollapsed)
  const width = useApp((s) => s.config.settings.sidebarWidth)
  const chatFirst = useApp((s) => s.config.settings.newPaneView === 'chat')
  const sideRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const indRef = useRef<HTMLDivElement>(null)
  const config = useApp((s) => s.config)
  const view = useApp((s) => s.view)
  const { workspaces } = config
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  const newLabel = chatFirst ? 'New chat' : 'New pane'

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

  // One highlight that slides to the selected row: the focused chat if its project is open,
  // else the active project. Moved by style, not state, so it never re-renders the list.
  useLayoutEffect(() => {
    const list = listRef.current
    const ind = indRef.current
    if (!list || !ind) return
    const place = (): void => {
      const row = list.querySelector<HTMLElement>('.ws-row.on')
      if (!row) {
        ind.style.opacity = '0'
        return
      }
      const top =
        row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
      ind.style.opacity = '1'
      ind.style.transform = `translateY(${top}px)`
      ind.style.height = `${row.offsetHeight}px`
      ind.style.left = `${row.getBoundingClientRect().left - list.getBoundingClientRect().left}px`
      ind.style.width = `${row.offsetWidth}px`
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(list)
    return () => ro.disconnect()
  }, [view, config, collapsed, width])

  return (
    <>
      <aside
        ref={sideRef}
        className={`side${collapsed ? ' col' : ''}${moving ? ' moving' : ''}`}
        aria-label="Sidebar"
        style={{ '--side-width': `${width}px` } as CSSProperties}
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
              aria-label={`${newLabel} (${SHORTCUT_HINT.newPane})`}
              title={`${newLabel} (${SHORTCUT_HINT.newPane})`}
              onClick={newPane}
            >
              <IconCompose />
            </button>
          )}
        </div>

        {collapsed ? (
          <>
            <div className="rail">
              <button
                className="icon-btn"
                aria-label={`${newLabel} (${SHORTCUT_HINT.newPane})`}
                title={`${newLabel} (${SHORTCUT_HINT.newPane})`}
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
            </div>
            <div className="side-ft">
              <AccountSwitcher compact />
            </div>
          </>
        ) : (
          <>
            <nav className="side-nav" aria-label="Quick actions">
              <button
                className="nav-row"
                onClick={newPane}
                title={`${newLabel} (${SHORTCUT_HINT.newPane})`}
              >
                <IconCompose />
                <span>{newLabel}</span>
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
            <div className="sec side-list" ref={listRef}>
              <div className="side-ind" ref={indRef} aria-hidden="true" />
              <div className="sec-hd">
                <span>Projects</span>
                <button
                  onClick={() => actions.openModal({ kind: 'workspaces' })}
                  title="New or manage projects"
                  aria-label="Manage projects"
                >
                  <IconPlus small />
                </button>
              </div>
              {workspaces.map((w, i) => (
                <WorkspaceRow key={w.id} w={w} index={i} />
              ))}
            </div>
            <div className="side-ft">
              <AccountSwitcher compact={false} />
            </div>
          </>
        )}
      </aside>
      {collapsed ? null : (
        <EdgeResizer
          target={sideRef}
          cssVar="--side-w"
          edge="right"
          min={SIDEBAR_WIDTH_MIN}
          max={SIDEBAR_WIDTH_MAX}
          label="Resize sidebar"
          onCommit={(w) => actions.updateSettings({ sidebarWidth: w })}
          onReset={() => actions.updateSettings({ sidebarWidth: SIDEBAR_WIDTH_DEFAULT })}
        />
      )}
    </>
  )
}
