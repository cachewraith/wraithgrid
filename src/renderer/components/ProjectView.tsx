import { useEffect, useState, type MouseEvent } from 'react'
import { contractHome, expandHome } from '@shared/paths'
import { PANE_STATUS_LABEL, type Pane } from '@shared/types'
import { useActions, useApp } from '../app/services'
import { accountById, activeWorkspace } from '../app/store'
import { ago } from '../lib/time'
import { ContextMenu, menuPoint, type MenuPoint } from './ContextMenu'
import { IconCompose, IconSearch, IconTrash } from './icons'

/** Matches a chat by its title, account or folder; every word must appear. */
function matchesQuery(q: string, ...fields: string[]): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = fields.join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** The trash button on a chat row: asks before anything is deleted. */
function DeleteButton({ wsId, pane }: { wsId: string; pane: Pane }) {
  const actions = useActions()
  return (
    <button
      className="pj-del"
      aria-label={`Delete ${pane.title}`}
      title="Delete chat"
      onClick={() => actions.openModal({ kind: 'deleteChat', wsId, paneId: pane.id })}
    >
      <IconTrash small />
    </button>
  )
}

function OpenRow({
  pane,
  now,
  onMenu
}: {
  pane: Pane
  now: number
  onMenu: (e: MouseEvent<HTMLElement>) => void
}) {
  const actions = useActions()
  const account = useApp((s) => accountById(s.config, pane.accountId))
  const status = useApp((s) => s.runtime[pane.id]?.status ?? null)
  const activeAt = useApp((s) => s.runtime[pane.id]?.activeAt ?? null)
  const busy = status === 'running' || status === 'starting' || status === 'background'
  const loud = status === 'approval' || status === 'login' || status === 'exited'
  return (
    <button className="pj-row" onClick={() => actions.revealPane(pane.id)} onContextMenu={onMenu}>
      <span className="pj-t">{pane.title}</span>
      <span className="pj-m">{account?.name ?? 'shell'}</span>
      <span className={`pj-st st-${status ?? 'idle'}`}>
        {busy ? (
          <span className={`pn-spin${status === 'background' ? ' bg' : ''}`} aria-hidden="true" />
        ) : null}
        {status === 'background' ? PANE_STATUS_LABEL.background : null}
        {loud && status ? PANE_STATUS_LABEL[status] : null}
        {!busy && !loud && activeAt ? ago(activeAt, now) : null}
        {!busy && !loud && !activeAt ? 'open' : null}
      </span>
    </button>
  )
}

/**
 * A project (workspace), as Claude's Projects page shows one: its open chats, and the ones
 * closed here, which reopen and carry on their conversation.
 */
export function ProjectView() {
  const actions = useActions()
  const ws = useApp(activeWorkspace)
  const accounts = useApp((s) => s.config.accounts)
  const home = useApp((s) => s.info.homeDir)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ at: MenuPoint; pane: Pane; open: boolean } | null>(null)
  const now = useNow()
  const menuFor =
    (pane: Pane, open: boolean) =>
    (e: MouseEvent<HTMLElement>): void => {
      e.preventDefault()
      setMenu({ at: menuPoint(e), pane, open })
    }

  const nameOf = (id: string | null): string => accounts.find((a) => a.id === id)?.name ?? 'shell'
  const folders = [...new Set(ws.panes.concat(ws.history.map((h) => h.pane)).map((p) => p.cwd))]
  const folder = folders.length === 1 ? contractHome(expandHome(folders[0]!, home), home) : null
  const open = ws.panes.filter((p) => matchesQuery(query, p.title, nameOf(p.accountId), p.cwd))
  const history = ws.history.filter((h) =>
    matchesQuery(query, h.pane.title, nameOf(h.pane.accountId), h.pane.cwd)
  )
  const total = ws.panes.length + ws.history.length

  return (
    <div className="page pj-page">
      <div className="pj">
        <header className="pj-hd">
          <div>
            <h1>{ws.name}</h1>
            <p>
              {[
                folder,
                `${ws.panes.length} open`,
                ws.history.length ? `${ws.history.length} in history` : null
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <button
            className="btn pri"
            onClick={() => actions.openModal({ kind: 'newPane', slotId: null })}
          >
            <IconCompose small />
            New chat
          </button>
        </header>

        {total > 0 ? (
          <label className="pj-search">
            <IconSearch small />
            <input
              type="search"
              placeholder="Search chats…"
              aria-label="Search chats"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        ) : null}

        {total === 0 ? (
          <div className="pj-empty">
            <h2>No chats yet</h2>
            <p>
              Start one in this project; it shows up here, and stays in History after you close it.
            </p>
          </div>
        ) : null}

        {open.length ? (
          <section aria-label="Open chats">
            <h2 className="pj-h">Open</h2>
            <div className="pj-list">
              {open.map((p) => (
                <div key={p.id} className="pj-hrow">
                  <OpenRow pane={p} now={now} onMenu={menuFor(p, true)} />
                  <DeleteButton wsId={ws.id} pane={p} />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {history.length ? (
          <section aria-label="History">
            <h2 className="pj-h">History</h2>
            <div className="pj-list">
              {history.map((h) => (
                <div key={h.pane.id} className="pj-hrow">
                  <button
                    className="pj-row"
                    title="Reopen and carry on this conversation"
                    onClick={() => actions.reopenChat(ws.id, h.pane.id)}
                    onContextMenu={menuFor(h.pane, false)}
                  >
                    <span className="pj-t">{h.pane.title}</span>
                    <span className="pj-m">{nameOf(h.pane.accountId)}</span>
                    <span className="pj-st">{ago(h.closedAt, now)}</span>
                  </button>
                  <DeleteButton wsId={ws.id} pane={h.pane} />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {total > 0 && !open.length && !history.length ? (
          <p className="pj-none">No chats match “{query}”.</p>
        ) : null}

        {menu ? (
          <ContextMenu
            at={menu.at}
            label={`Chat ${menu.pane.title}`}
            onClose={() => setMenu(null)}
            items={[
              {
                label: menu.open ? 'Open' : 'Reopen',
                onSelect: () =>
                  menu.open
                    ? actions.revealPane(menu.pane.id)
                    : actions.reopenChat(ws.id, menu.pane.id)
              },
              {
                label: 'Delete chat…',
                icon: <IconTrash small />,
                danger: true,
                divider: true,
                onSelect: () =>
                  actions.openModal({ kind: 'deleteChat', wsId: ws.id, paneId: menu.pane.id })
              }
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}
