import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent
} from 'react'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  PANE_STATUS_LABEL,
  type Config,
  type Pane,
  type Workspace
} from '@shared/types'
import { useActions, useApp, useServices } from '../app/services'
import { accountById, activeWorkspace } from '../app/store'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { AccountAvatar, ProviderLogo } from './ProviderLogo'
import { ProjectIcon } from './ProjectIcon'
import { ContextMenu, menuPoint, type MenuPoint } from './ContextMenu'
import { EdgeResizer } from './EdgeResizer'
import {
  IconChevron,
  IconClock,
  IconGlobe,
  IconCompose,
  IconGauge,
  IconMods,
  IconMonitor,
  IconPlus,
  IconRename,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconTrash,
  IconUserPlus,
  IconUsers,
  IconPlay,
  IconStop
} from './icons'
import { ago } from '../lib/time'
import { panesOpen, panesPerAccount } from '../lib/usage-format'
import { useNow } from './ProjectView'
import { sessionLimitLabel, useSessionLimit, useTicker } from './UsageView'
import { nextAccount } from '../lib/auto-switch'
import { liveWindow, type UsageWindow as UsageWin } from '@shared/usage'

export function accountColorsFor(config: Config, wsId: string): string[] {
  const ws = config.workspaces.find((w) => w.id === wsId)
  if (!ws) return []
  const ids = [...new Set(ws.panes.map((p) => p.accountId).filter((x): x is string => !!x))]
  return ids.flatMap((id) => config.accounts.find((a) => a.id === id)?.color ?? [])
}

/** Below this window width (CSS px, so zoom counts) the sidebar folds to its rail. */
const NARROW_PX = 900

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_PX)
  useEffect(() => {
    const sync = (): void => setNarrow(window.innerWidth < NARROW_PX)
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])
  return narrow
}

/** How long the collapse/expand transition runs (matches `.side` in base.css), plus slack. */
const SIDE_MOVE_MS = 260

/** One project (workspace): click to switch, right-click to rename, re-icon or delete. */
function WorkspaceRow({ w, index }: { w: Workspace; index: number }) {
  const actions = useActions()
  const config = useApp((s) => s.config)
  // Highlighted on its own screen; in the grid the focused chat's row is.
  const on = useApp((s) => s.config.activeWorkspace === w.id && s.view === 'project')
  const running = useApp((s) => w.panes.some((p) => s.runtime[p.id]?.status === 'running'))
  const background = useApp((s) => w.panes.some((p) => s.runtime[p.id]?.status === 'background'))
  const waiting = useApp((s) =>
    w.panes.some((p) => {
      const st = s.runtime[p.id]?.status
      return st === 'approval' || st === 'login'
    })
  )
  const openList = useApp((s) => s.config.settings.sidebarOpenProjects)
  const [menu, setMenu] = useState<MenuPoint | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const key = index < 9 ? index + 1 : null
  const canDelete = config.workspaces.length > 1
  const panes = w.panes.length
  const teamOn = w.panes.some((p) => w.team.some((a) => a.id === p.teamAgentId))
  const history = w.history.length
  const count = panes
    ? `${panes} ${panes === 1 ? 'chat' : 'chats'}`
    : history
      ? `${history} in history`
      : 'No chats yet'
  const state = waiting ? 'needs you' : running ? 'working' : 'in background'
  const busy = waiting || running || background
  const hint = key ? ` (${SHORTCUT_HINT.workspaceN(key)})` : ''
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

  // A dropdown of the project's chats (#67); open or closed is saved per project. Empty
  // projects open too, to a "New chat" row, so every project keeps its chevron (#87).
  const open = openList.includes(w.id)
  const setOpen = (next: boolean): void => {
    if (next === open) return
    const ids = new Set(config.workspaces.map((x) => x.id))
    const kept = openList.filter((id) => id !== w.id && ids.has(id))
    actions.updateSettings({ sidebarOpenProjects: next ? [...kept, w.id] : kept })
  }
  const listId = `side-chats-${w.id}`

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
          aria-label="Project name"
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
    <div
      className={`proj${panes ? '' : ' proj-empty'}${!open && (running || background) ? ' working' : ''}`}
    >
      <div className={`ws-wrap${menu ? ' menu' : ''}`}>
        <button
          className="ws-tg"
          aria-label={open ? `Hide chats in ${w.name}` : `Show chats in ${w.name}`}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onMouseDown={keepFocus}
          onClick={() => setOpen(!open)}
        >
          <IconChevron small className={`chev-i${open ? ' open' : ''}`} />
        </button>
        <button
          className={`ws-row${on ? ' on' : ''}${menu ? ' menu' : ''}`}
          aria-current={on ? 'true' : undefined}
          title={[w.name, count, busy ? state : null].filter(Boolean).join(' · ') + hint}
          onMouseDown={keepFocus}
          onClick={() => actions.openProject(w.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault()
              setOpen(e.key === 'ArrowRight')
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setConfirmDelete(false)
            setMenu(menuPoint(e))
          }}
        >
          <ProjectIcon icon={w.icon} />
          <span className="ws-name">{w.name}</span>
          {machine ? (
            <span className="ws-mach" title={`Runs on ${machine.name} (${machine.sshHost})`}>
              {machine.name}
            </span>
          ) : null}
          {/* A closed project says it's working; approvals show on the chat only (#75). */}
          {!open && (running || background) ? (
            <span className="sch-st working">working</span>
          ) : panes ? (
            <span className="ws-n">{panes}</span>
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
      {open ? <ProjectChats w={w} id={listId} onNewChat={newChat} /> : null}
      {menu ? (
        <ContextMenu
          at={menu}
          label={`Project ${w.name}`}
          onClose={() => setMenu(null)}
          items={[
            { label: 'New chat', icon: <IconCompose small />, onSelect: newChat },
            ...(w.team.length
              ? [
                  teamOn
                    ? {
                        label: 'Stop team',
                        icon: <IconStop small />,
                        onSelect: () => actions.stopTeam(w.id)
                      }
                    : {
                        label: 'Start team',
                        icon: <IconPlay small />,
                        onSelect: () => void actions.startTeam(w.id)
                      }
                ]
              : []),
            ...(w.machineId
              ? []
              : [
                  {
                    label: 'Preview',
                    icon: <IconGlobe small />,
                    onSelect: () => void actions.openPreview(w.id)
                  }
                ]),
            { label: 'Rename', icon: <IconRename small />, onSelect: () => setRenaming(w.name) },
            {
              label: 'Change icon',
              icon: <ProjectIcon icon={w.icon} size={14} />,
              onSelect: () => actions.openModal({ kind: 'projectIcon', wsId: w.id })
            },
            ...(config.machines.length ? runOn : []),
            {
              label: !canDelete
                ? 'Delete (last project)'
                : confirmDelete
                  ? panes
                    ? `Click again: closes ${panes} ${panes === 1 ? 'pane' : 'panes'}`
                    : 'Click again to delete'
                  : 'Delete project',
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

/** The last part of a folder path: what a card shows when the folder isn't a git repo. */
function folderName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

/** Clicks don't move keyboard focus onto sidebar rows, so a later key press shows no ring. */
const keepFocus = (e: MouseEvent): void => e.preventDefault()

/**
 * One open chat as a plain row under its project: its title, and its time or state on the
 * right. Branch (or folder) and account are in its tooltip.
 */
function ChatRow({ pane, now }: { pane: Pane; now: number }) {
  const actions = useActions()
  const account = useApp((s) => accountById(s.config, pane.accountId))
  const status = useApp((s) => s.runtime[pane.id]?.status ?? null)
  const activeAt = useApp((s) => s.runtime[pane.id]?.activeAt ?? null)
  const branch = useApp((s) => s.git[pane.id]?.branch ?? null)
  const on = useApp((s) => s.focusedPaneId === pane.id && s.view === 'grid')
  const busy = status === 'running' || status === 'starting' || status === 'background'
  const loud = status === 'approval' || status === 'login'
  const when = activeAt ? ago(activeAt, now) : null
  const tip = [pane.title, branch ?? folderName(pane.cwd), account?.name].filter(Boolean)
  return (
    <button
      className={`side-chat${on ? ' on' : ''}${busy ? ' busy' : ''}`}
      aria-current={on ? 'true' : undefined}
      title={tip.join(' · ')}
      onMouseDown={keepFocus}
      onClick={() => actions.revealPane(pane.id)}
    >
      {account ? (
        <ProviderLogo cli={account.cli} fallbackName={account.name} size={13} />
      ) : (
        <IconMonitor small />
      )}
      <span className="sch-t">{pane.title}</span>
      {/* States as words (#75): a light sweeps across "working"; no spinners or dots. */}
      {loud && status ? (
        <span className="sch-st warn" title={PANE_STATUS_LABEL[status]}>
          {status === 'login' ? 'sign in' : 'approve'}
        </span>
      ) : busy ? (
        <span className="sch-st working" title={PANE_STATUS_LABEL[status!]}>
          {status === 'background' ? 'background' : 'working'}
        </span>
      ) : when ? (
        <span className="sch-when">{when}</span>
      ) : null}
    </button>
  )
}

/**
 * A project's open chats, most recently active first (never-active ones keep their order);
 * an empty project offers "New chat" instead.
 */
function ProjectChats({ w, id, onNewChat }: { w: Workspace; id: string; onNewChat: () => void }) {
  const runtime = useApp((s) => s.runtime)
  const now = useNow()
  const chats = w.panes
    .map((pane) => ({ pane, at: runtime[pane.id]?.activeAt ?? -1 }))
    .sort((a, b) => b.at - a.at)
  return (
    <div className="side-chats" id={id} role="group" aria-label={`Chats in ${w.name}`}>
      {chats.map(({ pane }) => (
        <ChatRow key={pane.id} pane={pane} now={now} />
      ))}
      {chats.length ? null : (
        <button className="side-chat side-new" onMouseDown={keepFocus} onClick={onNewChat}>
          <IconPlus small />
          <span className="sch-t">New chat</span>
        </button>
      )}
    </div>
  )
}

/** When a window resets: the time today, else the weekday ("13:40", "Mon"). */
function resetLabel(at: number, now: number): string {
  const d = new Date(at)
  return at - now < 20 * 3_600_000
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : d.toLocaleDateString(undefined, { weekday: 'short' })
}

function UsageWindow({
  name,
  w,
  now,
  mark
}: {
  name: string
  w: UsageWin
  now: number
  mark: number
}) {
  const pct = Math.round(w.utilization * 100)
  const sev = pct >= 95 ? ' full' : pct >= 80 ? ' hot' : ''
  return (
    <span className={`su-win${sev}`}>
      <span>{name}</span>
      <span className="su-meter">
        <i style={{ width: `${Math.min(pct, 100)}%` }} />
        <b style={{ left: `${mark}%` }} />
      </span>
      <span className="su-pct">{pct}%</span>
      <span className="su-at">{resetLabel(w.resetsAt, now)}</span>
    </span>
  )
}

/**
 * Usage under New chat and Search (#75): the account whose limits these are, a line per
 * window (5-hour, week) with its reset, colour only near the limit, and where auto-switch
 * (#61) would go. Opens the Usage screen.
 */
function SidebarUsage() {
  const actions = useActions()
  const on = useApp((s) => s.view === 'usage')
  const limit = useSessionLimit(true)
  const accounts = useApp((s) => s.config.accounts)
  const limits = useApp((s) => s.usage.limits)
  const auto = useApp((s) => s.config.settings.autoSwitchAtLimit)
  const at = useApp((s) => s.config.settings.autoSwitchAt)
  const now = useTicker(60_000)
  const account = accounts.find((a) => a.id === limit.account?.id) ?? null
  const lim = account ? limits[account.id] : undefined
  const five = liveWindow(lim?.fiveHour ?? null, now)
  const week = liveWindow(lim?.sevenDay ?? null, now)
  const next = account && auto ? nextAccount(accounts, account, limits, now, at) : null
  return (
    <button
      className={`side-use${on ? ' on' : ''}`}
      aria-current={on ? 'page' : undefined}
      aria-label={`${sessionLimitLabel(limit)}; open the Usage screen`}
      title={sessionLimitLabel(limit)}
      onClick={() => actions.setView('usage')}
    >
      <span className="su-hd">
        {account ? (
          <ProviderLogo cli={account.cli} fallbackName={account.name} size={12} />
        ) : (
          <IconGauge small />
        )}
        <span className="su-nm">{account?.name ?? 'Usage'}</span>
        <IconChevron small className="su-go" />
      </span>
      {five ? <UsageWindow name="5h" w={five} now={now} mark={at} /> : null}
      {week ? <UsageWindow name="week" w={week} now={now} mark={at} /> : null}
      {!five && !week ? <span className="su-ft">no limits yet</span> : null}
      {(five || week) && next ? (
        <span className="su-ft">
          at {at}% switches to <b>{next.name}</b>
        </span>
      ) : null}
    </button>
  )
}

/** The footer: who new chats run as, ChatGPT-style; the menu switches it and leads to accounts. */
function AccountSwitcher({ compact }: { compact: boolean }) {
  const actions = useActions()
  const accounts = useApp((s) => s.config.accounts)
  const defaultId = useApp((s) => s.config.settings.defaultAccountId)
  const [menu, setMenu] = useState<{ at: MenuPoint; width: number } | null>(null)
  const current = accounts.find((a) => a.id === defaultId) ?? accounts[0]
  const plans = useApp((s) => s.accountInfo)
  const plan = (current ? plans[current.id]?.info?.plan : null) ?? null
  const workspaces = useApp((s) => s.config.workspaces)
  const inUse = useMemo(() => panesPerAccount({ workspaces }), [workspaces])
  const open = (e: MouseEvent<HTMLButtonElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    // Sits on top of the button, as wide as it (a little wider than the icon rail's).
    setMenu({ at: { x: r.left, y: r.top - 6 }, width: Math.max(r.width, 240) })
  }
  const label = current ? current.name : 'No account'
  return (
    <>
      <button
        className={`acct-sw${compact ? ' compact' : ''}${menu ? ' open' : ''}`}
        aria-label={`New chats use: ${label}. Switch account`}
        aria-haspopup="menu"
        title={compact ? `New chats use ${label}` : undefined}
        onClick={open}
      >
        {current ? (
          <AccountAvatar cli={current.cli} name={current.name} size={26} />
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
                <span>
                  {accounts.length === 0
                    ? 'Add one to start'
                    : current && !current.signedIn
                      ? 'Login needed'
                      : `${plan ?? `${accounts.length} account${accounts.length === 1 ? '' : 's'}`} · new chats`}
                </span>
              </span>
            </span>
            <IconChevron small className="acct-chev" />
          </>
        )}
      </button>
      {menu ? (
        <ContextMenu
          at={menu.at}
          width={menu.width}
          above
          className="acct-menu"
          label="Accounts"
          onClose={() => setMenu(null)}
          items={[
            ...accounts.map((a, i) => ({
              label: a.name,
              // Each pane runs its own account (#49): the tick only says who new chats use.
              sub: [
                a.signedIn ? (plans[a.id]?.info?.plan ?? 'Signed in') : 'Login needed',
                inUse[a.id] ? panesOpen(inUse[a.id]!) : null
              ]
                .filter(Boolean)
                .join(' · '),
              subWarn: !a.signedIn,
              checked: a.id === current?.id,
              heading: i === 0 ? 'New chats use' : undefined,
              icon: <AccountAvatar cli={a.cli} name={a.name} size={26} />,
              onSelect: () => actions.updateSettings({ defaultAccountId: a.id })
            })),
            {
              label: 'New account',
              icon: <IconUserPlus small />,
              onSelect: () => actions.setAccountsMode('add')
            },
            {
              label: 'Usage',
              icon: <IconGauge small />,
              divider: true,
              onSelect: () => actions.setView('usage')
            },
            {
              label: 'Manage accounts',
              icon: <IconUsers small />,
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

/** Compact project navigation retains identity and work state when the sidebar is collapsed. */
function RailProject({ w }: { w: Workspace }) {
  const actions = useActions()
  const on = useApp((s) => s.config.activeWorkspace === w.id)
  const working = useApp((s) =>
    w.panes.some((p) =>
      ['running', 'starting', 'background'].includes(s.runtime[p.id]?.status ?? '')
    )
  )
  return (
    <button
      className={`rail-ws${on ? ' on' : ''}${working ? ' working' : ''}`}
      aria-label={`Open project ${w.name}${working ? ', working' : ''}`}
      aria-current={on ? 'page' : undefined}
      title={`${w.name}${working ? ' · working' : ''}`}
      onClick={() => actions.openProject(w.id)}
    >
      <ProjectIcon icon={w.icon} size={20} />
    </button>
  )
}

function SidebarMeta() {
  const workspace = useApp(activeWorkspace)
  const paneCount = workspace.panes.length
  const accounts = new Set(workspace.panes.flatMap((p) => (p.accountId ? [p.accountId] : []))).size
  const version = useApp((s) => s.info.version)
  return (
    <div className="side-meta">
      <span>
        {paneCount} {paneCount === 1 ? 'pane' : 'panes'}
      </span>
      <span>
        {accounts} {accounts === 1 ? 'account' : 'accounts'}
      </span>
      {version ? <span className="side-version">v{version}</span> : null}
    </div>
  )
}

export function Sidebar() {
  const actions = useActions()
  const savedCollapsed = useApp((s) => s.config.settings.sidebarCollapsed)
  const activeWs = useApp((s) => s.config.activeWorkspace)
  // A narrow window shows the rail; expanding it opens the full sidebar over the content
  // (a drawer) without changing the saved choice.
  const narrow = useNarrow()
  const [drawer, setDrawer] = useState(false)
  if (drawer && !narrow) setDrawer(false)
  const collapsed = narrow ? !drawer : savedCollapsed
  const toggle = narrow ? (): void => setDrawer(!drawer) : actions.toggleSidebar
  const width = useApp((s) => s.config.settings.sidebarWidth)
  const sideRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const indRef = useRef<HTMLDivElement>(null)
  const config = useApp((s) => s.config)
  const view = useApp((s) => s.view)
  const { workspaces } = config

  // The project holding the focused chat opens its dropdown (#67), once per focus change.
  const focusWs = useApp(
    (s) => s.config.workspaces.find((w) => w.panes.some((p) => p.id === s.focusedPaneId))?.id
  )
  const { store } = useServices()
  useEffect(() => {
    const st = store.getState()
    const open = st.config.settings.sidebarOpenProjects
    if (focusWs && !open.includes(focusWs))
      st.updateSettings({ sidebarOpenProjects: [...open, focusWs] })
  }, [focusWs, store])

  // The drawer closes once you go somewhere, or on Escape.
  const place = `${view}:${activeWs}`
  const [lastPlace, setLastPlace] = useState(place)
  if (place !== lastPlace) {
    setLastPlace(place)
    setDrawer(false)
  }
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDrawer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  const newLabel = 'New chat'

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
      const on = list.querySelector<HTMLElement>('.ws-row.on')
      const row = on?.closest<HTMLElement>('.ws-wrap') ?? on
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
        className={`side${collapsed ? ' col' : ''}${moving ? ' moving' : ''}${narrow && drawer ? ' drawer' : ''}`}
        aria-label="Sidebar"
        style={{ '--side-width': `${width}px` } as CSSProperties}
      >
        <div className="side-hd">
          {collapsed ? null : <span className="side-brand">Wraithgrid</span>}
          <button
            className="icon-btn"
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={toggle}
          >
            <IconSidebar />
          </button>
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
              <button
                className={`icon-btn${view === 'usage' ? ' on' : ''}`}
                aria-label="Usage"
                title="Usage"
                onClick={() => actions.setView('usage')}
              >
                <IconGauge />
              </button>
              <div className="rail-sep" />
              {workspaces.map((w) => (
                <RailProject key={w.id} w={w} />
              ))}
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
              <button
                className={`nav-row${view === 'scheduled' ? ' on' : ''}`}
                aria-current={view === 'scheduled' ? 'page' : undefined}
                onClick={() => actions.setView('scheduled')}
                title="Scheduled chats"
              >
                <IconClock />
                <span>Scheduled</span>
              </button>
            </nav>
            <SidebarUsage />
            <div className="sec side-list" ref={listRef}>
              <div className="side-ind" ref={indRef} aria-hidden="true" />
              <div className="sec-hd">
                <span>Projects</span>
                <button
                  onClick={() => actions.openModal({ kind: 'newProject' })}
                  title="New project"
                  aria-label="New project"
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
              <SidebarMeta />
            </div>
          </>
        )}
      </aside>
      {narrow && drawer ? (
        <div className="side-scrim" aria-hidden="true" onClick={() => setDrawer(false)} />
      ) : null}
      {collapsed || narrow ? null : (
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
