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
import { useActions, useApp } from '../app/services'
import { accountById } from '../app/store'
import { SHORTCUT_HINT } from '../app/shortcuts'
import { Initial } from './AccountIcon'
import { ContextMenu, menuPoint, type MenuPoint } from './ContextMenu'
import { EdgeResizer } from './EdgeResizer'
import {
  IconChevron,
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
  IconUsers
} from './icons'
import { ago } from '../lib/time'
import { panesOpen, panesPerAccount } from '../lib/usage-format'
import { useNow } from './ProjectView'
import { sessionLimitLabel, useSessionLimit } from './UsageView'

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
  const on = useApp(
    (s) => s.config.activeWorkspace === w.id && (s.view === 'grid' || s.view === 'project')
  )
  const running = useApp((s) => w.panes.some((p) => s.runtime[p.id]?.status === 'running'))
  const background = useApp((s) => w.panes.some((p) => s.runtime[p.id]?.status === 'background'))
  const waiting = useApp((s) =>
    w.panes.some((p) => {
      const st = s.runtime[p.id]?.status
      return st === 'approval' || st === 'login'
    })
  )
  const lastAt = useApp((s) =>
    w.panes.reduce<number | null>((m, p) => {
      const t = s.runtime[p.id]?.activeAt ?? null
      return t !== null && (m === null || t > m) ? t : m
    }, null)
  )
  const now = useNow()
  const [menu, setMenu] = useState<MenuPoint | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const key = index < 9 ? index + 1 : null
  const canDelete = config.workspaces.length > 1
  const panes = w.panes.length
  const history = w.history.length
  const count = panes
    ? `${panes} ${panes === 1 ? 'chat' : 'chats'}`
    : history
      ? `${history} in history`
      : 'No chats yet'
  const state = waiting
    ? 'needs you'
    : running
      ? 'working'
      : background
        ? 'in background'
        : lastAt !== null
          ? ago(lastAt, now)
          : null
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
          <span className="ws-txt">
            <span className="ws-name">{w.name}</span>
            <span className={`ws-sub${waiting ? ' warn' : running || background ? ' busy' : ''}`}>
              {count}
              {state ? ` · ${state}` : null}
            </span>
          </span>
          {machine ? (
            <span className="ws-mach" title={`Runs on ${machine.name} (${machine.sshHost})`}>
              {machine.name}
            </span>
          ) : null}
          {waiting ? (
            <span className="ws-wait" title="A chat needs you" />
          ) : running ? (
            <span className="pn-spin" title="A chat is working" />
          ) : background ? (
            <span className="pn-spin bg" title="A chat has work running in the background" />
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
          label={`Project ${w.name}`}
          onClose={() => setMenu(null)}
          items={[
            { label: 'New chat', icon: <IconCompose small />, onSelect: newChat },
            { label: 'Rename', icon: <IconRename small />, onSelect: () => setRenaming(w.name) },
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

/** A project's short badge: the first letters of its first two words, else its first two. */
export function projectBadge(name: string): string {
  const words = name
    .trim()
    .split(/[\s_.-]+/)
    .filter(Boolean)
  const letters =
    words.length > 1 ? words.slice(0, 2).map((w) => [...w][0]) : [...(words[0] ?? '?')].slice(0, 2)
  return letters.join('').toUpperCase()
}

/** One open chat as a card (#59): project and time, the chat's title, its branch and account. */
function ChatCard({ w, pane, now }: { w: Workspace; pane: Pane; now: number }) {
  const actions = useActions()
  const account = useApp((s) => accountById(s.config, pane.accountId))
  const status = useApp((s) => s.runtime[pane.id]?.status ?? null)
  const activeAt = useApp((s) => s.runtime[pane.id]?.activeAt ?? null)
  const branch = useApp((s) => s.git[pane.id]?.branch ?? null)
  const on = useApp((s) => s.focusedPaneId === pane.id && s.view === 'grid')
  const busy = status === 'running' || status === 'starting' || status === 'background'
  const loud = status === 'approval' || status === 'login'
  const when = loud && status ? PANE_STATUS_LABEL[status] : activeAt ? ago(activeAt, now) : null
  return (
    <button
      className={`chat-card${on ? ' on' : ''}`}
      aria-current={on ? 'true' : undefined}
      title={`${pane.title} · ${w.name}`}
      onClick={() => actions.revealPane(pane.id)}
    >
      <span className="cc-top">
        <span className="cc-badge" aria-hidden="true">
          {projectBadge(w.name)}
        </span>
        <span className="cc-proj">{w.name}</span>
        {busy ? (
          <span className={`pn-spin${status === 'background' ? ' bg' : ''}`} aria-hidden="true" />
        ) : null}
        {when ? <span className={`cc-when${loud ? ' warn' : ''}`}>{when}</span> : null}
      </span>
      <span className="cc-title">{pane.title}</span>
      <span className="cc-bot">
        <span className="cc-branch">{branch ?? ''}</span>
        {account ? (
          <span title={account.name}>
            <Initial name={account.name} size={20} />
          </span>
        ) : null}
      </span>
    </button>
  )
}

/** Every open chat, most recently active first (never-active ones keep their order, last). */
function ChatCards() {
  const workspaces = useApp((s) => s.config.workspaces)
  const runtime = useApp((s) => s.runtime)
  const now = useNow()
  const chats = workspaces
    .flatMap((w) => w.panes.map((pane) => ({ w, pane, at: runtime[pane.id]?.activeAt ?? -1 })))
    .sort((a, b) => b.at - a.at)
  if (!chats.length) return null
  return (
    <>
      <div className="sec-hd">
        <span>
          Chats <span className="sec-n">{chats.length}</span>
        </span>
      </div>
      <div className="cc-list">
        {chats.map(({ w, pane }) => (
          <ChatCard key={pane.id} w={w} pane={pane} now={now} />
        ))}
      </div>
    </>
  )
}

/** "Usage" under New chat and Search, with the session limit on the right once known. */
function UsageNavRow() {
  const actions = useActions()
  const on = useApp((s) => s.view === 'usage')
  const limit = useSessionLimit()
  return (
    <button
      className={`nav-row${on ? ' on' : ''}`}
      aria-current={on ? 'page' : undefined}
      title={sessionLimitLabel(limit)}
      onClick={() => actions.setView('usage')}
    >
      <IconGauge />
      <span>Usage</span>
      {limit.pct !== null ? (
        <span className={`nav-pct sev-${limit.sev}`}>
          {limit.named && limit.account ? `${limit.account.name} · ` : ''}
          {limit.pct}%
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
                    : `New chats · ${plan ?? `${accounts.length} account${accounts.length === 1 ? '' : 's'}`}`}
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
              icon: <Initial name={a.name} size={26} />,
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
  const chatFirst = useApp((s) => s.config.settings.newPaneView === 'chat')
  const sideRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const indRef = useRef<HTMLDivElement>(null)
  const config = useApp((s) => s.config)
  const view = useApp((s) => s.view)
  const { workspaces } = config

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
        className={`side${collapsed ? ' col' : ''}${moving ? ' moving' : ''}${narrow && drawer ? ' drawer' : ''}`}
        aria-label="Sidebar"
        style={{ '--side-width': `${width}px` } as CSSProperties}
      >
        <div className="side-hd">
          <button
            className="icon-btn"
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={toggle}
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
              <button
                className={`icon-btn${view === 'usage' ? ' on' : ''}`}
                aria-label="Usage"
                title="Usage"
                onClick={() => actions.setView('usage')}
              >
                <IconGauge />
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
              <UsageNavRow />
            </nav>
            <div className="sec side-list" ref={listRef}>
              <div className="side-ind" ref={indRef} aria-hidden="true" />
              <ChatCards />
              <div className="sec-hd">
                <span>
                  Projects <span className="sec-n">{workspaces.length}</span>
                </span>
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
